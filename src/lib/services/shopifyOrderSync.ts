import "server-only";

import { SyncStatus } from "@/generated/prisma";
import { getShopifyConfig } from "@/lib/env";
import { writeSyncLog } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { shopifyApiRequest } from "@/lib/services/shopifyService";
import {
  normalizeShopifyOrder,
  type NormalizedShopifyOrder,
} from "@/lib/services/shopifyOrders";

// Shopify 주문을 우리 주문 표로 가져온다. 재고와 재고 이력은 이미 채널과 무관한
// 한 곳에 있으므로, 주문만 들어오면 eBay 주문과 같은 화면·같은 규칙으로 처리된다.

const CHANNEL = "SHOPIFY";

function toInputJson(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

async function fetchShopifyOrders(limit: number, updatedAfter: Date | null) {
  const config = getShopifyConfig();
  const params = new URLSearchParams({
    status: "any",
    limit: String(Math.min(250, Math.max(1, limit))),
  });
  if (updatedAfter) params.set("updated_at_min", updatedAfter.toISOString());

  const body = await shopifyApiRequest(config, {
    path: `/orders.json?${params.toString()}`,
  });
  const orders = (body as { orders?: unknown })?.orders;
  return Array.isArray(orders) ? orders : [];
}

async function saveShopifyOrder(
  userId: string,
  parsed: NormalizedShopifyOrder,
) {
  // Shopify는 우리 쪽 eBay 계정과 무관해 계정 자리가 비어 있다. 비어 있는 값이
  // 섞인 복합 유니크는 upsert로 쓸 수 없으므로 찾아보고 만들거나 고친다. 같은
  // 주문이 두 번 들어오는 것은 데이터베이스의 부분 유니크 색인이 막는다.
  const existing = await prisma.order.findFirst({
    where: { channel: CHANNEL, externalOrderId: parsed.externalOrderId },
    select: { id: true },
  });

  const order = existing
    ? await prisma.order.update({
        where: { id: existing.id },
        data: {
          orderStatus: parsed.orderStatus,
          fulfillmentStatus: parsed.fulfillmentStatus,
          buyerName: parsed.buyerName,
          buyerUsername: parsed.buyerUsername,
          buyerCountry: parsed.buyerCountry,
          totalAmount: parsed.totalAmount,
          currency: parsed.currency,
          orderDate: parsed.orderDate,
          paidAt: parsed.paidAt,
          rawJson: toInputJson(parsed.rawJson),
        },
        select: { id: true },
      })
    : await prisma.order.create({
        data: {
          userId,
          channel: CHANNEL,
          externalOrderId: parsed.externalOrderId,
          orderStatus: parsed.orderStatus,
          fulfillmentStatus: parsed.fulfillmentStatus,
          buyerName: parsed.buyerName,
          buyerUsername: parsed.buyerUsername,
          buyerCountry: parsed.buyerCountry,
          totalAmount: parsed.totalAmount,
          currency: parsed.currency,
          orderDate: parsed.orderDate,
          paidAt: parsed.paidAt,
          rawJson: toInputJson(parsed.rawJson),
        },
        select: { id: true },
      });

  // Shopify 상품에는 우리가 올릴 때 SKU를 넣으므로, 주문 줄의 SKU로 카드를 바로
  // 찾을 수 있다. eBay처럼 제목으로 짐작할 일이 없다.
  const skus = [
    ...new Set(parsed.items.map((item) => item.sku).filter(Boolean)),
  ] as string[];
  const products = skus.length
    ? await prisma.product.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true },
      })
    : [];
  const productBySku = new Map(
    products.map((product) => [product.sku, product.id]),
  );

  let matched = 0;
  for (const item of parsed.items) {
    const productId = item.sku ? (productBySku.get(item.sku) ?? null) : null;
    if (productId) matched += 1;
    await prisma.orderItem.upsert({
      where: {
        orderId_lineItemId: { orderId: order.id, lineItemId: item.lineItemId },
      },
      update: { title: item.title, sku: item.sku, quantity: item.quantity },
      create: {
        orderId: order.id,
        lineItemId: item.lineItemId,
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
        // 이미 재고를 뺀 줄의 연결은 건드리지 않는다. 사람이 고친 연결도 지키려면
        // 새로 만들 때만 자동 연결을 넣어야 한다.
        productId,
        matchedBy: productId ? "sku" : null,
      },
    });
  }

  return { orderId: order.id, itemCount: parsed.items.length, matched };
}

export async function syncShopifyOrders(input: {
  userId: string;
  limit?: number;
  updatedAfter?: Date | null;
  logType?: string;
}) {
  const logType = input.logType ?? "shopify.orders.sync";
  const updatedAfter = input.updatedAfter ?? null;
  let raws: unknown[];
  try {
    raws = await fetchShopifyOrders(input.limit ?? 50, updatedAfter);
  } catch (error) {
    await writeSyncLog(
      input.userId,
      logType,
      SyncStatus.FAILED,
      error instanceof Error ? error.message : "Unknown Shopify sync error",
    );
    throw error;
  }
  let saved = 0;
  let items = 0;
  let matched = 0;
  const skipped: string[] = [];

  for (const raw of raws) {
    const parsed = normalizeShopifyOrder(raw);
    if (!parsed) {
      skipped.push("주문번호가 없어 건너뜀");
      continue;
    }
    const result = await saveShopifyOrder(input.userId, parsed);
    saved += 1;
    items += result.itemCount;
    matched += result.matched;
  }

  safeLog("info", "shopify.orders.synced", {
    fetched: raws.length,
    saved,
    items,
    matched,
  });
  await writeSyncLog(
    input.userId,
    logType,
    SyncStatus.SUCCESS,
    `${saved} Shopify orders synced.`,
    {
      updatedAfter: updatedAfter?.toISOString() ?? null,
      fetched: raws.length,
      saved,
      items,
      matched,
      skipped,
    },
  );
  return { fetched: raws.length, saved, items, matched, skipped };
}
