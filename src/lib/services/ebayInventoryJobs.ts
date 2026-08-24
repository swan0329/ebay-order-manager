import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";
import { listingReviseTarget, reviseTargetKey } from "@/lib/services/ebayRevise";
import type { Prisma } from "@/generated/prisma";

const JOB_SOURCE = "ebay_inventory_change";
const ACTIVE = ["pending", "running"];
const STALE_AFTER_MS = 5 * 60_000;
const PROCESS_CHUNK_SIZE = 24;

type JobPayload = {
  batchId: string;
  productId: string;
  action: "CHANGE" | "UNAVAILABLE";
};

function payload(raw: Prisma.JsonValue | null): JobPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.batchId !== "string" || typeof value.productId !== "string") return null;
  if (value.action !== "CHANGE" && value.action !== "UNAVAILABLE") return null;
  return { batchId: value.batchId, productId: value.productId, action: value.action };
}

export async function enqueueEbayInventoryJobs(input: {
  userId: string;
  productIds: string[];
  action: "CHANGE" | "UNAVAILABLE";
}) {
  const productIds = [...new Set(input.productIds)];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true } });
  const activeJobs = await prisma.productUploadJob.findMany({
    where: { userId: input.userId, source: JOB_SOURCE, status: { in: ACTIVE } },
    select: { rawJson: true },
  });
  const alreadyQueued = new Set(activeJobs.flatMap((job) => {
    const value = payload(job.rawJson);
    return value ? [value.productId] : [];
  }));
  const byId = new Map(products.map((product) => [product.id, product]));
  const batchId = randomUUID();
  const rows = productIds.flatMap((productId) => {
    const product = byId.get(productId);
    if (!product || alreadyQueued.has(productId)) return [];
    return [{
      userId: input.userId,
      productId,
      sku: product.sku,
      source: JOB_SOURCE,
      action: input.action,
      status: "pending",
      message: "eBay 전송 대기",
      rawJson: { batchId, productId, action: input.action },
    }];
  });
  if (rows.length) await prisma.productUploadJob.createMany({ data: rows });
  return getEbayInventoryJobSummary(input.userId, rows.length ? batchId : undefined);
}

export async function processEbayInventoryJobs(userId: string, limit = 200) {
  await prisma.productUploadJob.updateMany({
    where: {
      userId,
      source: JOB_SOURCE,
      status: "running",
      startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
    },
    data: { status: "pending", message: "중단된 서버 작업 자동 재개", startedAt: null },
  });

  const candidates = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE, status: "pending" },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(200, limit)),
  });
  const claimed = [];
  for (const job of candidates) {
    const result = await prisma.productUploadJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "running", message: "eBay 전송·실제 반영 확인 중", startedAt: new Date(), error: null, errorSummary: null },
    });
    if (result.count) claimed.push(job);
  }
  if (!claimed.length) return getEbayInventoryJobSummary(userId);

  const claimedPayloads = claimed.flatMap((job) => {
    const value = payload(job.rawJson);
    return value ? [{ job, value }] : [];
  });
  const validJobIds = new Set(claimedPayloads.map(({ job }) => job.id));
  const invalidJobs = claimed.filter((job) => !validJobIds.has(job.id));
  if (invalidJobs.length) await prisma.productUploadJob.updateMany({
    where: { id: { in: invalidJobs.map((job) => job.id) } },
    data: { status: "failed", message: "작업 데이터 손상", error: "저장된 eBay 작업 대상을 읽지 못했습니다.", errorSummary: "저장된 eBay 작업 대상을 읽지 못했습니다.", finishedAt: new Date() },
  });
  if (!claimedPayloads.length) return getEbayInventoryJobSummary(userId);
  for (let offset = 0; offset < claimedPayloads.length; offset += PROCESS_CHUNK_SIZE) {
    const chunk = claimedPayloads.slice(offset, offset + PROCESS_CHUNK_SIZE);
    const productIds = chunk.map(({ value }) => value.productId);
    try {
      // 큐에 넣은 값이 아니라 실행 시점의 최신 가격·재고를 다시 계산한다.
      // 작은 묶음마다 결과를 저장해 화면의 진행률이 실제 처리 상황을 반영한다.
      const result = await pushEbayInventory({ userId, productIds, dryRun: false, limit: PROCESS_CHUNK_SIZE });
      const rowByProduct = new Map(result.rows.map((row) => [row.productId, row]));
      const succeeded = new Set(result.succeededKeys);
      const failureByKey = new Map(result.failed.map((failure) => [failure.targetKey, failure.reason]));

      const updates = [];
      for (const { job, value } of chunk) {
        const row = rowByProduct.get(value.productId);
        const key = row ? reviseTargetKey(listingReviseTarget({ itemId: row.itemId, sku: row.sku, listingType: row.listingType, quantity: row.quantity, price: row.price })) : null;
        if (key && succeeded.has(key)) {
          updates.push(prisma.productUploadJob.update({ where: { id: job.id }, data: {
            status: "success",
            message: "eBay 재조회로 가격·재고 실제 반영 확인 완료",
            finishedAt: new Date(),
            finalPayloadJson: { itemId: row!.itemId, sku: row!.sku, price: row!.price, quantity: row!.quantity },
          } }));
        } else {
          const reason = key ? failureByKey.get(key) : null;
          const message = reason ?? "실행 시점에 활성 eBay 연결 대상을 찾지 못했습니다.";
          updates.push(prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", message: "eBay 가격·재고 반영 실패", error: message, errorSummary: message, finishedAt: new Date() } }));
        }
      }
      if (updates.length) await prisma.$transaction(updates);
      const rateLimited = result.failed.some((failure) => /호출 한도|rate|limit|temporarily blocked/iu.test(failure.reason));
      if (rateLimited && offset + PROCESS_CHUNK_SIZE < claimedPayloads.length) {
        const remainingIds = claimedPayloads.slice(offset + PROCESS_CHUNK_SIZE).map(({ job }) => job.id);
        const message = "eBay 호출 제한을 감지해 아직 보내지 않은 항목을 중지했습니다. 잠시 뒤 실패건 재시작을 눌러 주세요.";
        await prisma.productUploadJob.updateMany({ where: { id: { in: remainingIds }, status: "running" }, data: { status: "failed", message: "eBay 보호를 위해 미전송 중지", error: message, errorSummary: message, finishedAt: new Date() } });
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "eBay 가격·재고 작업 실패";
      const currentIds = chunk.map(({ job }) => job.id);
      await prisma.productUploadJob.updateMany({ where: { id: { in: currentIds }, status: "running" }, data: { status: "failed", message: "eBay 반영 여부 재확인 필요", error: message, errorSummary: `${message} 다시 실행하면 최신 목표값으로 안전하게 재검증합니다.`, finishedAt: new Date() } });
      const remainingIds = claimedPayloads.slice(offset + PROCESS_CHUNK_SIZE).map(({ job }) => job.id);
      if (remainingIds.length) await prisma.productUploadJob.updateMany({ where: { id: { in: remainingIds }, status: "running" }, data: { status: "pending", message: "앞 묶음 오류로 대기 후 자동 재개", startedAt: null } });
      break;
    }
  }
  return getEbayInventoryJobSummary(userId);
}

export async function getEbayInventoryJobSummary(userId: string, requestedBatchId?: string) {
  const jobs = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, productId: true, sku: true, action: true, status: true, message: true, errorSummary: true, rawJson: true, createdAt: true, startedAt: true, finishedAt: true },
  });
  const active = jobs.filter((job) => ACTIVE.includes(job.status));
  const latestBatchId = requestedBatchId ?? active.map((job) => payload(job.rawJson)?.batchId).find(Boolean) ?? jobs.map((job) => payload(job.rawJson)?.batchId).find(Boolean) ?? null;
  const batch = latestBatchId ? jobs.filter((job) => payload(job.rawJson)?.batchId === latestBatchId) : [];
  const succeeded = batch.filter((job) => job.status === "success").length;
  const failed = batch.filter((job) => job.status === "failed").length;
  return {
    kind: "inventory" as const,
    batchId: latestBatchId,
    active: active.length,
    pending: active.filter((job) => job.status === "pending").length,
    running: active.filter((job) => job.status === "running").length,
    succeeded,
    failed,
    completed: succeeded + failed,
    total: batch.length,
    jobs: batch.map((job) => ({ id: job.id, productId: job.productId, sku: job.sku, action: job.action, status: job.status, message: job.message, errorSummary: job.errorSummary, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt })),
  };
}
