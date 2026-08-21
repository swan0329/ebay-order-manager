import "server-only";

import { EbayEnvironment, Prisma } from "@/generated/prisma";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { endEbayListing } from "@/lib/services/ebayEndListing";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { getActiveVariationProductListings } from "@/lib/variation-selling-state";

export const ZERO_STOCK_END_LISTING = "ZERO_STOCK_END_LISTING";
export const automationModes = ["NOTIFY", "AUTOMATIC"] as const;

export async function ensureDefaultAutomationRule() {
  return prisma.automationRule.upsert({
    where: { key: ZERO_STOCK_END_LISTING },
    update: {},
    create: { key: ZERO_STOCK_END_LISTING, enabled: true, mode: "NOTIFY" },
  });
}

export async function previewZeroStockListings(userId: string, productIds?: string[]) {
  const variationProducts = await getActiveVariationProductListings(userId);
  const products = await prisma.product.findMany({
    where: {
      ...(productIds?.length ? { id: { in: productIds } } : {}),
      OR: [
        { ebayItemId: { not: null }, listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } },
        { productListings: { some: { channel: "EBAY", status: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } } } },
      ],
    },
    select: {
      id: true, sku: true, productName: true, stockQuantity: true, safetyStock: true,
      status: true, isSoldOut: true, pocamarketAvailableCount: true, pocamarketSyncedAt: true,
      updatedAt: true,
      ebayItemId: true,
      productListings: { where: { channel: "EBAY" }, take: 1, select: { externalId: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return products.flatMap((product) => {
    // 묶음의 부모 Item ID를 End 하면 살아 있는 다른 옵션까지 함께 사라진다.
    // 옵션 수량 반영은 앞선 채널 재고 동기화가 SKU 단위로 처리한다.
    if (variationProducts.has(product.id)) return [];
    const availability = resolveChannelAvailability({
      status: product.status,
      stockQuantity: product.stockQuantity,
      safetyStock: product.safetyStock,
      isSoldOut: product.isSoldOut,
      pocamarketAvailableCount: product.pocamarketAvailableCount,
      pocamarketSyncedAt: product.pocamarketSyncedAt,
    });
    // 자동 End는 양쪽 공급이 최신 값으로 확인된 "진짜 품절" 단품만 대상으로 한다.
    if (availability.availabilityStatus !== "SOLD_OUT") return [];
    const itemId = product.productListings[0]?.externalId ?? product.ebayItemId;
    return itemId ? [{ ...product, itemId, productListings: undefined, availability }] : [];
  });
}

export async function runZeroStockRule(input: { userId: string; productIds: string[] }) {
  const rule = await ensureDefaultAutomationRule();
  if (!rule.enabled) return { mode: rule.mode, candidates: 0, ended: 0, notified: 0, failed: 0 };
  const candidates = await previewZeroStockListings(input.userId, input.productIds);
  const account = rule.mode === "AUTOMATIC"
    ? await prisma.ebayAccount.findFirst({
        where: { userId: input.userId, environment: currentEbayEnvironment() },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  let ended = 0;
  let notified = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const triggerKey = `${candidate.id}:${candidate.updatedAt.toISOString()}`;
    const event = await prisma.automationEvent.upsert({
      where: { ruleId_triggerKey: { ruleId: rule.id, triggerKey } },
      update: {},
      create: {
        ruleId: rule.id,
        productId: candidate.id,
        triggerKey,
        status: rule.mode === "AUTOMATIC" ? "PENDING" : "NOTIFIED",
        message: `재고 0: ${candidate.sku} / eBay ${candidate.itemId}`,
        rawJson: { itemId: candidate.itemId, sku: candidate.sku } satisfies Prisma.InputJsonValue,
      },
    });
    if (event.status !== "PENDING") {
      if (event.status === "NOTIFIED") notified += 1;
      continue;
    }
    if (!account || account.environment !== EbayEnvironment.PRODUCTION) {
      await prisma.automationEvent.update({ where: { id: event.id }, data: { status: "FAILED", message: `${event.message} / 운영 eBay 계정 없음` } });
      failed += 1;
      continue;
    }
    try {
      await endEbayListing(account, candidate.itemId);
      await prisma.$transaction([
        prisma.product.update({ where: { id: candidate.id }, data: { listingStatus: "ENDED" } }),
        prisma.productListing.updateMany({ where: { productId: candidate.id, channel: "EBAY" }, data: { status: "ENDED", quantity: 0 } }),
        prisma.automationEvent.update({ where: { id: event.id }, data: { status: "EXECUTED" } }),
      ]);
      ended += 1;
    } catch (error) {
      await prisma.automationEvent.update({ where: { id: event.id }, data: { status: "FAILED", message: `${event.message} / ${error instanceof Error ? error.message : "실행 실패"}` } });
      failed += 1;
    }
  }
  safeLog("info", "automation.zero_stock.completed", { mode: rule.mode, candidates: candidates.length, ended, notified, failed });
  return { mode: rule.mode, candidates: candidates.length, ended, notified, failed };
}
