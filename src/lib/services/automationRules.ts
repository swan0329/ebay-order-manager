import "server-only";

import { EbayEnvironment, Prisma } from "@/generated/prisma";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { endEbayListing } from "@/lib/services/ebayEndListing";

export const ZERO_STOCK_END_LISTING = "ZERO_STOCK_END_LISTING";
export const automationModes = ["NOTIFY", "AUTOMATIC"] as const;

export async function ensureDefaultAutomationRule() {
  return prisma.automationRule.upsert({
    where: { key: ZERO_STOCK_END_LISTING },
    update: {},
    create: { key: ZERO_STOCK_END_LISTING, enabled: true, mode: "NOTIFY" },
  });
}

export async function previewZeroStockListings(productIds?: string[]) {
  const products = await prisma.product.findMany({
    where: {
      stockQuantity: { lte: 0 },
      ...(productIds?.length ? { id: { in: productIds } } : {}),
      OR: [
        { ebayItemId: { not: null }, listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } },
        { productListings: { some: { channel: "EBAY", status: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } } } },
      ],
    },
    select: {
      id: true, sku: true, productName: true, stockQuantity: true, updatedAt: true,
      ebayItemId: true,
      productListings: { where: { channel: "EBAY" }, take: 1, select: { externalId: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return products.flatMap((product) => {
    const itemId = product.productListings[0]?.externalId ?? product.ebayItemId;
    return itemId ? [{ ...product, itemId, productListings: undefined }] : [];
  });
}

export async function runZeroStockRule(input: { userId: string; productIds: string[] }) {
  const rule = await ensureDefaultAutomationRule();
  if (!rule.enabled) return { mode: rule.mode, candidates: 0, ended: 0, notified: 0, failed: 0 };
  const candidates = await previewZeroStockListings(input.productIds);
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
