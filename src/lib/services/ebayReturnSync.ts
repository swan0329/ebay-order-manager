import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { EbayEnvironment, SyncStatus } from "@/generated/prisma";
import { EbayApiError, getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { restoreStockForReturnedOrderItem } from "@/lib/inventory";
import { writeSyncLog } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { syncInventoryChannelsAfterChange } from "@/lib/services/automaticChannelInventorySync";

export const EBAY_RETURN_SYNC_LOG_TYPE = "ebay.returns.sync.cron";
const PAGE_LIMIT = 200;
const LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function parseReceivedEbayReturn(value: unknown) {
  const summary = record(value);
  const creationInfo = record(summary.creationInfo);
  const item = record(creationInfo.item);
  const status = text(summary.status)?.toUpperCase() ?? "";

  if (status !== "ITEM_DELIVERED") return null;

  const returnId = text(summary.returnId);
  const orderId = text(summary.orderId);
  const itemId = text(item.itemId);
  const transactionId = text(item.transactionId);
  const returnQuantity = positiveInteger(item.returnQuantity);
  if (!returnId || !orderId || !itemId || !transactionId || !returnQuantity) return null;

  return { returnId, orderId, itemId, transactionId, returnQuantity };
}

async function requestReturns(account: EbayAccount, from: Date, to: Date) {
  const config = getEbayConfig();
  const members: unknown[] = [];
  let offset = 0;

  while (true) {
    const url = new URL("/post-order/v2/return/search", config.hosts.api);
    url.searchParams.set("creation_date_range_from", from.toISOString());
    url.searchParams.set("creation_date_range_to", to.toISOString());
    url.searchParams.set("states", "ITEM_DELIVERED");
    url.searchParams.set("role", "SELLER");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    const token = await getValidAccessToken(account);
    const response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new EbayApiError("eBay return search failed.", response.status, body);

    const payload = record(body);
    const page = Array.isArray(payload.members) ? payload.members : [];
    members.push(...page);
    const pagination = record(payload.paginationOutput);
    const totalEntries = typeof pagination.totalEntries === "number"
      ? pagination.totalEntries
      : members.length;
    offset += page.length;
    if (page.length === 0 || offset >= totalEntries) break;
  }

  return members;
}

function rawLegacyIds(value: unknown) {
  const raw = record(value);
  return {
    itemId: text(raw.legacyItemId),
    transactionId: text(raw.legacyTransactionId),
  };
}

export async function syncReceivedEbayReturns(account: EbayAccount, now = new Date()) {
  if (account.environment !== EbayEnvironment.PRODUCTION) {
    return { fetched: 0, received: 0, restored: 0, skipped: 0, unsupported: true };
  }

  const from = new Date(now.getTime() - LOOKBACK_MS);
  const rawReturns = await requestReturns(account, from, now);
  let received = 0;
  let restored = 0;
  let skipped = 0;
  const productIds = new Set<string>();

  for (const rawReturn of rawReturns) {
    const parsed = parseReceivedEbayReturn(rawReturn);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    received += 1;

    const order = await prisma.order.findFirst({
      where: {
        channel: "EBAY",
        ebayAccountId: account.id,
        OR: [{ externalOrderId: parsed.orderId }, { ebayOrderId: parsed.orderId }],
      },
      include: { items: true },
    });
    const matchingItems = order?.items.filter((orderItem) => {
      const ids = rawLegacyIds(orderItem.rawJson);
      return ids.itemId === parsed.itemId && ids.transactionId === parsed.transactionId;
    }) ?? [];
    if (matchingItems.length !== 1) {
      skipped += 1;
      continue;
    }

    const result = await restoreStockForReturnedOrderItem({
      orderItemId: matchingItems[0].id,
      returnQuantity: parsed.returnQuantity,
      returnId: parsed.returnId,
      createdBy: account.userId,
    });
    restored += result.restored;
    result.productIds.forEach((id) => productIds.add(id));
    if (!result.restored) skipped += 1;
  }

  if (productIds.size > 0) {
    await syncInventoryChannelsAfterChange({
      userId: account.userId,
      productIds: [...productIds],
    });
  }

  const result = { fetched: rawReturns.length, received, restored, skipped, unsupported: false };
  await writeSyncLog(account.userId, EBAY_RETURN_SYNC_LOG_TYPE, SyncStatus.SUCCESS,
    `${restored} eBay returned order items restored.`, result);
  safeLog("info", "ebay.returns.synced", { accountId: account.id, ...result });
  return result;
}
