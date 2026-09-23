import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { fetchPocamarketProductState, loadPocamarketApiConfig } from "@/lib/pocamarket-api-collector";
import { recordPocamarketObservation } from "@/lib/pocamarket-sync";
import { procurementRefreshDue } from "@/lib/procurement-freshness";
import type { Product } from "@/generated/prisma";

// A short, audited preflight. Failed checks keep the last successful source
// observation, but lastAttemptAt makes its supply unavailable until recovery.
export async function refreshProcurementProduct<T extends Product>(product: T, userId?: string, force = false): Promise<T> {
  if (!force && !procurementRefreshDue(product)) return product;
  if (!/^\d+$/.test(product.pocamarketId ?? "")) return product;
  const current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (!force && !procurementRefreshDue(current)) return { ...product, ...current };
  // Concurrent channel workers wait for the existing check. An abandoned
  // request can be retried after one minute; it is never considered success.
  if (current.pocamarketLastAttemptAt && current.pocamarketLastAttemptAt > (current.pocamarketSyncedAt ?? new Date(0)) &&
    Date.now() - current.pocamarketLastAttemptAt.getTime() < 60_000) return { ...product, ...current };
  const owner = userId ?? (await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } }))?.id;
  if (!owner) throw new Error("포카마켓 재확인 관리자 정보가 없습니다.");
  const claimAt = new Date();
  const claimed = await prisma.product.updateMany({
    where: { id: current.id, pocamarketLastAttemptAt: current.pocamarketLastAttemptAt },
    data: { pocamarketLastAttemptAt: claimAt },
  });
  if (!claimed.count) return { ...product, ...await prisma.product.findUniqueOrThrow({ where: { id: product.id } }) };
  const workerMarker = `WORKER:${randomUUID()}`;
  const batch = await prisma.pocamarketSyncBatch.create({ data: {
    userId: owner, status: "RUNNING", totalCount: 1, startedAt: claimAt, deviceSerial: workerMarker,
    items: { create: { status: "RUNNING", deviceSerial: workerMarker, productId: current.id, productNumber: current.pocamarketId!, previousPrice: current.salePrice,
      previousAvailableCount: current.pocamarketAvailableCount, previousIsSoldOut: current.isSoldOut } },
  }, include: { items: true } });
  let observation;
  try {
    const config = { ...loadPocamarketApiConfig(), maxRetries: 1, requestTimeoutMs: 8_000 };
    const state = await fetchPocamarketProductState(current.pocamarketId!, config, { deadlineAt: Date.now() + 20_000 });
    observation = { availability: state.isSoldOut ? "SOLD_OUT" as const : "AVAILABLE" as const,
      observedPrice: state.price, observedAvailableCount: state.availableCount ?? undefined, responseAdapter: state.adapter };
  } catch {
    observation = { errorMessage: "판매 전 포카마켓 가격·수량 재확인 실패. 조달 수량 판매 보류 후 자동 재시도합니다.", errorCode: "PREFLIGHT_FAILED" };
  }
  await recordPocamarketObservation(batch.items[0].id, workerMarker, observation);
  await prisma.pocamarketSyncBatch.update({ where: { id: batch.id }, data: {
    status: "availability" in observation ? "APPLIED" : "FAILED", completedAt: new Date(),
    errorMessage: "errorMessage" in observation ? observation.errorMessage : null,
  } });
  return { ...product, ...await prisma.product.findUniqueOrThrow({ where: { id: product.id } }) };
}

export async function refreshProcurementGroup<T extends Product>(products: T[], userId: string) {
  const result: T[] = [];
  const deadline = Date.now() + 60_000;
  for (const product of products) {
    if (Date.now() >= deadline && procurementRefreshDue(product)) {
      throw new Error("옵션 상품의 포카마켓 재확인을 진행했습니다. 남은 상품은 다시 등록할 때 이어서 확인합니다.");
    }
    result.push(await refreshProcurementProduct(product, userId));
  }
  return result;
}
