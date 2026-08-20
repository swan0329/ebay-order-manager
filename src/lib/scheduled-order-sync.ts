import "server-only";

import { SyncStatus, UserRole } from "@/generated/prisma";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { syncOrdersForUser, writeSyncLog } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { syncShopifyOrders } from "@/lib/services/shopifyOrderSync";

export const EBAY_CRON_LOG_TYPE = "orders.sync.cron";
export const SHOPIFY_CRON_LOG_TYPE = "shopify.orders.sync.cron";
const FIRST_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000;

export function incrementalSyncStart(
  lastSuccessfulAt: Date | null,
  now: Date,
): Date {
  return new Date(
    lastSuccessfulAt
      ? lastSuccessfulAt.getTime() - OVERLAP_MS
      : now.getTime() - FIRST_SYNC_LOOKBACK_MS,
  );
}

async function lastSuccess(type: string, userId?: string) {
  return prisma.syncLog.findFirst({
    where: { type, status: SyncStatus.SUCCESS, ...(userId ? { userId } : {}) },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
}

export async function runScheduledOrderSync(now = new Date()) {
  const environment = currentEbayEnvironment();
  const accounts = await prisma.ebayAccount.findMany({
    where: { environment },
    distinct: ["userId"],
    orderBy: { updatedAt: "desc" },
    select: { userId: true },
  });
  const fallbackAdmin = accounts.length
    ? null
    : await prisma.user.findFirst({
        where: { role: UserRole.ADMIN },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  const ownerUserId = accounts[0]?.userId ?? fallbackAdmin?.id ?? null;

  const shopifyCursor = await lastSuccess(SHOPIFY_CRON_LOG_TYPE);
  const shopifyFrom = incrementalSyncStart(shopifyCursor?.createdAt ?? null, now);

  const ebayResults: Array<{
    userId: string;
    ok: boolean;
    imported?: number;
    error?: string;
  }> = [];
  for (const account of accounts) {
    const ebayCursor = await lastSuccess(EBAY_CRON_LOG_TYPE, account.userId);
    const ebayFrom = incrementalSyncStart(ebayCursor?.createdAt ?? null, now);
    try {
      const result = await syncOrdersForUser(
        account.userId,
        { modifiedDateFrom: ebayFrom.toISOString(), modifiedDateTo: now.toISOString() },
        { logType: EBAY_CRON_LOG_TYPE },
      );
      ebayResults.push({ userId: account.userId, ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown eBay sync error";
      ebayResults.push({ userId: account.userId, ok: false, error: message });
    }
  }

  let shopifyResult:
    | { ok: true; fetched: number; saved: number; items: number; matched: number }
    | { ok: false; error: string };
  if (!ownerUserId) {
    shopifyResult = { ok: false, error: "주문을 소유할 관리자 계정이 없습니다." };
    await writeSyncLog(null, SHOPIFY_CRON_LOG_TYPE, SyncStatus.FAILED, shopifyResult.error);
  } else {
    try {
      const result = await syncShopifyOrders({
        userId: ownerUserId,
        limit: 250,
        updatedAfter: shopifyFrom,
        logType: SHOPIFY_CRON_LOG_TYPE,
      });
      shopifyResult = { ok: true, ...result };
    } catch (error) {
      shopifyResult = {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Shopify sync error",
      };
    }
  }

  const ok = ebayResults.every((result) => result.ok) && shopifyResult.ok;
  safeLog(ok ? "info" : "warn", "orders.sync.cron.completed", {
    environment,
    shopifyFrom: shopifyFrom.toISOString(),
    ebayResults,
    shopifyResult,
  });

  return {
    ok,
    checkedAt: now.toISOString(),
    cursors: { shopifyFrom: shopifyFrom.toISOString() },
    ebay: ebayResults,
    shopify: shopifyResult,
  };
}
