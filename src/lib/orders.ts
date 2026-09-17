import { Prisma, SalesChannel, ShipmentStatus, SyncStatus } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  createShippingFulfillment,
  EbayApiError,
  getEbayListingImageUrl,
  getOrdersFromEbay,
  getShippingFulfillments,
  type EbayLineItemReference,
  type OrderSyncFilters,
} from "@/lib/ebay";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { deductStockForOrder } from "@/lib/inventory";
import { applyOrderAutomation, applyOrderAutomationMany } from "@/lib/order-automation";
import { orderItemImageUrlFromRaw } from "@/lib/order-images";
import { legacyListingReferenceFromOrderItemRaw } from "@/lib/services/matchingService";
import { safeLog } from "@/lib/safe-log";
import {
  getOrdersFromShopify,
  type ShopifyOrderNode,
} from "@/lib/shopify-orders";

type JsonRecord = Record<string, unknown>;

type ShipRequest = {
  orderId: string;
  carrierCode: string;
  trackingNumber: string;
};

function normalizeJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map(toInputJson) as Prisma.InputJsonValue;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    ) as Prisma.InputJsonValue;
  }

  return null;
}

function toInputJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return normalizeJson(value) ?? Prisma.JsonNull;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asDate(value: unknown) {
  const text = asString(value);
  if (!text) {
    return undefined;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function firstDate(values: unknown[]) {
  return values.map(asDate).find(Boolean);
}

function moneyValue(value: unknown) {
  const record = asRecord(value);
  const numberValue = asString(record.value);
  return numberValue ? Number(numberValue) || 0 : 0;
}

function moneyCurrency(value: unknown) {
  const record = asRecord(value);
  return asString(record.currency) ?? "USD";
}

export function parseEbayOrder(rawOrder: unknown) {
  const order = asRecord(rawOrder);
  const buyer = asRecord(order.buyer);
  const pricingSummary = asRecord(order.pricingSummary);
  const total = pricingSummary.total;
  const fulfillmentStartInstruction = asRecord(
    asArray(order.fulfillmentStartInstructions)[0],
  );
  const shippingStep = asRecord(fulfillmentStartInstruction.shippingStep);
  const shipTo = asRecord(shippingStep.shipTo);
  const address = asRecord(shipTo.contactAddress);
  const lineItems = asArray(order.lineItems);
  const paymentSummary = asRecord(order.paymentSummary);
  const payment = asRecord(asArray(paymentSummary.payments)[0]);
  const cancelStatus = asRecord(order.cancelStatus);
  const isCancelled =
    asString(cancelStatus.cancelState)?.toUpperCase() === "CANCELED" ||
    asString(order.orderPaymentStatus)?.toUpperCase() === "FULLY_REFUNDED";

  return {
    ebayOrderId: asString(order.orderId) ?? "",
    orderStatus: isCancelled
      ? "CANCELLED"
      : asString(order.orderStatus) ?? "UNKNOWN",
    fulfillmentStatus: asString(order.orderFulfillmentStatus) ?? "UNKNOWN",
    buyerName: asString(shipTo.fullName) ?? asString(buyer.username),
    buyerUsername: asString(buyer.username),
    buyerCountry: asString(address.countryCode),
    totalAmount: moneyValue(total),
    currency: moneyCurrency(total),
    orderDate: asDate(order.creationDate) ?? new Date(),
    paidAt: asDate(payment.paymentDate),
    // Fulfillment API는 lastModifiedDate로 준다. modifiedDate만 읽던 탓에 값이
    // 늘 비어 있었고, 바뀐 주문만 다시 저장하는 판단을 할 수 없었다.
    modifiedAt: asDate(order.lastModifiedDate) ?? asDate(order.modifiedDate),
    shipByDate: firstDate(
      lineItems.map((item) =>
        asRecord(asRecord(item).lineItemFulfillmentInstructions).shipByDate,
      ),
    ),
    items: lineItems.map((item) => {
      const record = asRecord(item);
      return {
        lineItemId: asString(record.lineItemId) ?? "",
        title: asString(record.title) ?? "Untitled item",
        sku: asString(record.sku),
        quantity: asNumber(record.quantity) ?? 1,
        rawJson: record,
        shipments: asArray(record.shipments),
      };
    }),
    rawJson: order,
  };
}

function idFromGid(value: string | undefined) {
  return value?.split("/").filter(Boolean).at(-1) ?? "";
}

export function parseShopifyOrder(rawOrder: ShopifyOrderNode) {
  const money = rawOrder.totalPriceSet?.shopMoney;
  const financialStatus = rawOrder.displayFinancialStatus ?? "UNKNOWN";
  const fulfillmentStatus = rawOrder.displayFulfillmentStatus ?? "UNFULFILLED";
  const paidStatuses = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);
  const externalOrderId = rawOrder.legacyResourceId ?? idFromGid(rawOrder.id);

  return {
    externalOrderId,
    orderNumber: rawOrder.name?.trim() || externalOrderId,
    orderStatus:
      rawOrder.cancelledAt || ["REFUNDED", "VOIDED"].includes(financialStatus)
        ? "CANCELLED"
        : "OPEN",
    fulfillmentStatus:
      fulfillmentStatus === "FULFILLED"
        ? "FULFILLED"
        : fulfillmentStatus === "PARTIALLY_FULFILLED" ||
            fulfillmentStatus === "IN_PROGRESS"
          ? "IN_PROGRESS"
          : "NOT_STARTED",
    buyerName:
      rawOrder.shippingAddress?.name ?? rawOrder.customer?.displayName ?? undefined,
    buyerUsername: undefined,
    buyerCountry: rawOrder.shippingAddress?.countryCodeV2 ?? undefined,
    totalAmount: Number(money?.amount) || 0,
    currency: money?.currencyCode ?? "USD",
    orderDate: asDate(rawOrder.createdAt) ?? new Date(),
    paidAt: paidStatuses.has(financialStatus)
      ? asDate(rawOrder.processedAt) ?? asDate(rawOrder.createdAt)
      : undefined,
    modifiedAt: asDate(rawOrder.updatedAt),
    shipByDate: undefined,
    items: (rawOrder.lineItems?.nodes ?? []).map((item) => ({
      lineItemId: item.id ?? "",
      title: item.name ?? item.title ?? "Untitled item",
      sku: item.sku ?? undefined,
      quantity: item.quantity ?? 1,
      rawJson: item,
    })),
    shipments: (rawOrder.fulfillments ?? []).flatMap((fulfillment) =>
      (fulfillment.trackingInfo ?? [])
        .filter((tracking) => tracking.number)
        .map((tracking) => ({
          fulfillmentId: fulfillment.id,
          status: fulfillment.status,
          shippedAt: fulfillment.createdAt,
          trackingNumber: tracking.number,
          carrierCode: tracking.company ?? "OTHER",
        })),
    ),
    rawJson: rawOrder,
  };
}

async function enrichOrderItemRawWithListingImage({
  ebayOrderId,
  lineItemId,
  rawJson,
  existingImageUrl,
}: {
  ebayOrderId: string;
  lineItemId: string;
  rawJson: JsonRecord;
  existingImageUrl?: string | null;
}) {
  const currentImageUrl = orderItemImageUrlFromRaw(rawJson);

  if (currentImageUrl) {
    return rawJson;
  }

  if (existingImageUrl) {
    return {
      ...rawJson,
      soldImageUrl: existingImageUrl,
      ebayListingImageUrl: existingImageUrl,
    };
  }

  const reference = legacyListingReferenceFromOrderItemRaw(rawJson);

  if (!reference) {
    safeLog("info", "orders.sync.item_image.skipped", {
      ebayOrderId,
      lineItemId,
      reason: "missing_legacy_item_id",
    });
    return rawJson;
  }

  safeLog("info", "orders.sync.item_image.lookup", {
    ebayOrderId,
    lineItemId,
    legacyItemIdPresent: Boolean(reference.legacyItemId),
    legacyVariationIdPresent: Boolean(reference.legacyVariationId),
    legacyVariationSkuPresent: Boolean(reference.legacyVariationSku),
    marketplaceId: reference.marketplaceId,
  });

  try {
    const imageUrl = await getEbayListingImageUrl(reference);

    if (!imageUrl) {
      safeLog("warn", "orders.sync.item_image.missing", {
        ebayOrderId,
        lineItemId,
        legacyItemIdPresent: Boolean(reference.legacyItemId),
      });
      return rawJson;
    }

    safeLog("info", "orders.sync.item_image.resolved", {
      ebayOrderId,
      lineItemId,
      legacyItemIdPresent: Boolean(reference.legacyItemId),
    });

    return {
      ...rawJson,
      soldImageUrl: imageUrl,
      ebayListingImageUrl: imageUrl,
    };
  } catch (error) {
    safeLog("warn", "orders.sync.item_image.failed", {
      ebayOrderId,
      lineItemId,
      status: error instanceof EbayApiError ? error.status : undefined,
      body: error instanceof EbayApiError ? error.body : undefined,
      message: error instanceof Error ? error.message : "Unknown image lookup error",
    });
    return rawJson;
  }
}

export async function writeSyncLog(
  userId: string | null,
  type: string,
  status: SyncStatus,
  message: string,
  rawJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
) {
  await prisma.syncLog.create({
    data: { userId, type, status, message, rawJson },
  });
}

// 동기화가 어디서 느린지 구간별로 잰다. 숫자가 없으면 추측으로 고치게 된다.
export type OrderSyncTimings = Record<string, number>;
async function timed<T>(
  timings: OrderSyncTimings | undefined,
  label: string,
  run: () => Promise<T>,
) {
  if (!timings) return run();
  const started = Date.now();
  try {
    return await run();
  } finally {
    timings[label] = (timings[label] ?? 0) + (Date.now() - started);
  }
}

export async function saveEbayOrder(
  userId: string,
  ebayAccountId: string,
  rawOrder: unknown,
  timings?: OrderSyncTimings,
) {
  const parsed = parseEbayOrder(rawOrder);

  if (!parsed.ebayOrderId) {
    throw new Error("eBay order is missing orderId.");
  }

  const order = await timed(timings, "orderUpsert", () =>
    prisma.order.upsert({
    where: {
      ebayAccountId_ebayOrderId: {
        ebayAccountId,
        ebayOrderId: parsed.ebayOrderId,
      },
    },
    update: {
      salesChannel: SalesChannel.EBAY,
      externalOrderId: parsed.ebayOrderId,
      orderNumber: parsed.ebayOrderId,
      orderStatus: parsed.orderStatus,
      fulfillmentStatus: parsed.fulfillmentStatus,
      buyerName: parsed.buyerName,
      buyerUsername: parsed.buyerUsername,
      buyerCountry: parsed.buyerCountry,
      totalAmount: parsed.totalAmount,
      currency: parsed.currency,
      orderDate: parsed.orderDate,
      paidAt: parsed.paidAt,
      modifiedAt: parsed.modifiedAt,
      shipByDate: parsed.shipByDate,
      rawJson: toInputJson(parsed.rawJson),
    },
    create: {
      userId,
      ebayAccountId,
      ebayOrderId: parsed.ebayOrderId,
      salesChannel: SalesChannel.EBAY,
      externalOrderId: parsed.ebayOrderId,
      orderNumber: parsed.ebayOrderId,
      orderStatus: parsed.orderStatus,
      fulfillmentStatus: parsed.fulfillmentStatus,
      buyerName: parsed.buyerName,
      buyerUsername: parsed.buyerUsername,
      buyerCountry: parsed.buyerCountry,
      totalAmount: parsed.totalAmount,
      currency: parsed.currency,
      orderDate: parsed.orderDate,
      paidAt: parsed.paidAt,
      modifiedAt: parsed.modifiedAt,
      shipByDate: parsed.shipByDate,
      rawJson: toInputJson(parsed.rawJson),
    },
    }),
  );

  const incomingLineItemIds = parsed.items
    .map((item) => item.lineItemId)
    .filter(Boolean);
  const existingItems = await timed(timings, "itemRead", () =>
    prisma.orderItem.findMany({
      where: { orderId: order.id },
      select: { lineItemId: true, rawJson: true },
    }),
  );
  const existingImageByLineItemId = new Map(
    existingItems
      .map((item) => [
        item.lineItemId,
        orderItemImageUrlFromRaw(item.rawJson),
      ] as const)
      .filter(([, imageUrl]) => Boolean(imageUrl)),
  );
  const itemsWithListingImages = await timed(timings, "itemImage", () =>
    Promise.all(
    parsed.items.map(async (item) => ({
      ...item,
      rawJson: await enrichOrderItemRawWithListingImage({
        ebayOrderId: parsed.ebayOrderId,
        lineItemId: item.lineItemId,
        rawJson: item.rawJson,
        existingImageUrl: existingImageByLineItemId.get(item.lineItemId),
      }),
    })),
    ),
  );

  await timed(timings, "itemWrite", () =>
    Promise.all(
    itemsWithListingImages
      .filter((item) => item.lineItemId)
      .map((item) =>
        prisma.orderItem.upsert({
          where: {
            orderId_lineItemId: {
              orderId: order.id,
              lineItemId: item.lineItemId,
            },
          },
          update: {
            title: item.title,
            sku: item.sku,
            quantity: item.quantity,
            rawJson: toInputJson(item.rawJson),
          },
          create: {
            orderId: order.id,
            lineItemId: item.lineItemId,
            title: item.title,
            sku: item.sku,
            quantity: item.quantity,
            rawJson: toInputJson(item.rawJson),
          },
        }),
      ),
    ),
  );

  await prisma.orderItem.deleteMany({
    where: {
      orderId: order.id,
      lineItemId: { notIn: incomingLineItemIds },
    },
  });

  const shipmentWrites = parsed.items.flatMap((item) =>
    item.shipments.map((shipment) => {
      const record = asRecord(shipment);
      const trackingNumber = asString(record.shipmentTrackingNumber);
      const carrierCode = asString(record.shippingCarrierCode);

      if (!trackingNumber || !carrierCode) {
        return null;
      }

      return prisma.shipment.upsert({
        where: {
          orderId_trackingNumber: {
            orderId: order.id,
            trackingNumber,
          },
        },
        update: {
          carrierCode,
          status: ShipmentStatus.COMPLETED,
          rawJson: toInputJson(record),
        },
        create: {
          orderId: order.id,
          carrierCode,
          trackingNumber,
          status: ShipmentStatus.COMPLETED,
          rawJson: toInputJson(record),
        },
      });
    }),
  );

  await timed(timings, "shipmentWrite", () =>
    Promise.all(shipmentWrites.filter((write) => write !== null)),
  );
  await timed(timings, "stock", () => deductStockForOrder(order.id, userId));
  await timed(timings, "automation", () => applyOrderAutomation(order.id));

  return order;
}

export async function saveShopifyOrder(userId: string, rawOrder: ShopifyOrderNode) {
  const parsed = parseShopifyOrder(rawOrder);
  if (!parsed.externalOrderId) {
    throw new Error("Shopify 주문에 주문 ID가 없습니다.");
  }

  const order = await prisma.order.upsert({
    where: {
      userId_salesChannel_externalOrderId: {
        userId,
        salesChannel: SalesChannel.SHOPIFY,
        externalOrderId: parsed.externalOrderId,
      },
    },
    update: {
      orderNumber: parsed.orderNumber,
      orderStatus: parsed.orderStatus,
      fulfillmentStatus: parsed.fulfillmentStatus,
      buyerName: parsed.buyerName,
      buyerUsername: parsed.buyerUsername,
      buyerCountry: parsed.buyerCountry,
      totalAmount: parsed.totalAmount,
      currency: parsed.currency,
      orderDate: parsed.orderDate,
      paidAt: parsed.paidAt,
      modifiedAt: parsed.modifiedAt,
      shipByDate: parsed.shipByDate,
      rawJson: toInputJson(parsed.rawJson),
    },
    create: {
      userId,
      salesChannel: SalesChannel.SHOPIFY,
      externalOrderId: parsed.externalOrderId,
      orderNumber: parsed.orderNumber,
      orderStatus: parsed.orderStatus,
      fulfillmentStatus: parsed.fulfillmentStatus,
      buyerName: parsed.buyerName,
      buyerUsername: parsed.buyerUsername,
      buyerCountry: parsed.buyerCountry,
      totalAmount: parsed.totalAmount,
      currency: parsed.currency,
      orderDate: parsed.orderDate,
      paidAt: parsed.paidAt,
      modifiedAt: parsed.modifiedAt,
      shipByDate: parsed.shipByDate,
      rawJson: toInputJson(parsed.rawJson),
    },
  });

  const incomingLineItemIds = parsed.items
    .map((item) => item.lineItemId)
    .filter(Boolean);
  for (const item of parsed.items) {
    if (!item.lineItemId) continue;
    await prisma.orderItem.upsert({
      where: {
        orderId_lineItemId: { orderId: order.id, lineItemId: item.lineItemId },
      },
      update: {
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
        rawJson: toInputJson(item.rawJson),
      },
      create: {
        orderId: order.id,
        lineItemId: item.lineItemId,
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
        rawJson: toInputJson(item.rawJson),
      },
    });
  }
  await prisma.orderItem.deleteMany({
    where: {
      orderId: order.id,
      stockDeducted: false,
      lineItemId: { notIn: incomingLineItemIds },
    },
  });

  for (const shipment of parsed.shipments) {
    if (!shipment.trackingNumber) continue;
    await prisma.shipment.upsert({
      where: {
        orderId_trackingNumber: {
          orderId: order.id,
          trackingNumber: shipment.trackingNumber,
        },
      },
      update: {
        carrierCode: shipment.carrierCode,
        status: ShipmentStatus.COMPLETED,
        shippedAt: asDate(shipment.shippedAt),
        rawJson: toInputJson(shipment),
      },
      create: {
        orderId: order.id,
        carrierCode: shipment.carrierCode,
        trackingNumber: shipment.trackingNumber,
        status: ShipmentStatus.COMPLETED,
        shippedAt: asDate(shipment.shippedAt),
        rawJson: toInputJson(shipment),
      },
    });
  }

  await deductStockForOrder(order.id, userId);
  await applyOrderAutomation(order.id);
  return order;
}

export async function syncShopifyOrdersForUser(
  userId: string,
  filters: OrderSyncFilters,
) {
  let imported = 0;
  try {
    for await (const orders of getOrdersFromShopify(filters)) {
      for (const rawOrder of orders) {
        await saveShopifyOrder(userId, rawOrder);
      }
      imported += orders.length;
    }
    await writeSyncLog(
      userId,
      "orders.sync.shopify",
      SyncStatus.SUCCESS,
      `${imported} Shopify orders synced.`,
      toInputJson({ filters, imported }),
    );
    return { imported, channel: SalesChannel.SHOPIFY };
  } catch (error) {
    await writeSyncLog(
      userId,
      "orders.sync.shopify",
      imported > 0 ? SyncStatus.PARTIAL : SyncStatus.FAILED,
      error instanceof Error ? error.message : "Unknown Shopify sync error",
    );
    throw error;
  }
}

/**
 * 이미 저장한 주문 중 eBay에서 바뀌지 않은 것을 가려낸다. 전체 주문 불러오기는
 * 매번 모든 주문을 다시 쓰느라 주문 1건에 10회가 넘는 DB 왕복을 반복했다.
 * 다만 재고 차감이나 자동 분류가 끝나지 않은 주문은 바뀌지 않았어도 다시 처리한다.
 */
async function findUnchangedEbayOrderIds(
  ebayAccountId: string,
  parsedOrders: Array<{ ebayOrderId: string; modifiedAt?: Date | null }>,
) {
  const ids = parsedOrders.map((order) => order.ebayOrderId).filter(Boolean);
  if (!ids.length) return new Set<string>();
  const rows = await prisma.$queryRaw<
    Array<{
      ebayOrderId: string;
      modifiedAt: Date | null;
      automationCheckedAt: Date | null;
      pendingItems: number;
    }>
  >`
    SELECT o."ebay_order_id" AS "ebayOrderId",
      o."modified_at" AS "modifiedAt",
      o."automation_checked_at" AS "automationCheckedAt",
      COUNT(oi."id") FILTER (
        WHERE oi."product_id" IS NULL AND oi."stock_deducted" = false
      )::int AS "pendingItems"
    FROM "orders" o
    LEFT JOIN "order_items" oi ON oi."order_id" = o."id"
    WHERE o."ebay_account_id" = ${ebayAccountId}
      AND o."ebay_order_id" IN (${Prisma.join(ids)})
    GROUP BY 1, 2, 3`;
  const stored = new Map(rows.map((row) => [row.ebayOrderId, row]));
  const unchanged = new Set<string>();
  for (const order of parsedOrders) {
    const row = stored.get(order.ebayOrderId);
    if (!row || !row.automationCheckedAt || row.pendingItems > 0) continue;
    // 시각이 없으면 비교할 근거가 없으므로 다시 저장한다.
    if (!order.modifiedAt || !row.modifiedAt) continue;
    if (order.modifiedAt.getTime() === row.modifiedAt.getTime())
      unchanged.add(order.ebayOrderId);
  }
  return unchanged;
}

export async function syncOrdersForUser(
  userId: string,
  filters: OrderSyncFilters,
  { refreshAll = false }: { refreshAll?: boolean } = {},
) {
  const environment = currentEbayEnvironment();
  const account = await prisma.ebayAccount.findFirst({
    where: { userId, environment },
    orderBy: { updatedAt: "desc" },
  });

  if (!account) {
    throw new Error("eBay 계정이 아직 연결되지 않았습니다.");
  }

  safeLog("info", "orders.sync.start", {
    userId,
    environment,
    accountId: account.id,
    ebayUserId: account.ebayUserId,
    filters,
  });

  const limit = 100;
  let offset = 0;
  let imported = 0;
  const timings: OrderSyncTimings = {};
  const syncStarted = Date.now();
  let skipped = 0;

  try {
    while (true) {
      const page = await timed(timings, "ebayFetch", () =>
        getOrdersFromEbay(account, filters, limit, offset),
      );
      const orders = page.orders ?? [];
      const unchanged = refreshAll
        ? new Set<string>()
        : await timed(timings, "changeCheck", () =>
            findUnchangedEbayOrderIds(
              account.id,
              orders.map((rawOrder) => {
                const parsed = parseEbayOrder(rawOrder);
                return {
                  ebayOrderId: parsed.ebayOrderId,
                  modifiedAt: parsed.modifiedAt,
                };
              }),
            ),
          );

      for (const rawOrder of orders) {
        const parsed = parseEbayOrder(rawOrder);
        if (unchanged.has(parsed.ebayOrderId)) {
          skipped += 1;
          continue;
        }
        await saveEbayOrder(userId, account.id, rawOrder, timings);
      }

      imported += orders.length;
      offset += limit;

      if (orders.length < limit || (page.total && offset >= page.total)) {
        break;
      }
    }

    await writeSyncLog(
      userId,
      "orders.sync",
      SyncStatus.SUCCESS,
      `${imported} orders synced.`,
      toInputJson({ filters, imported }),
    );

    safeLog("info", "orders.sync.completed", {
      userId,
      environment,
      accountId: account.id,
      imported,
      filters,
    });

    return {
      imported,
      skipped,
      saved: imported - skipped,
      elapsedMs: Date.now() - syncStarted,
      timings,
    };
  } catch (error) {
    safeLog("error", "orders.sync.failed", {
      userId,
      environment,
      accountId: account.id,
      filters,
      status: error instanceof EbayApiError ? error.status : undefined,
      body: error instanceof EbayApiError ? error.body : undefined,
      message:
        error instanceof Error
          ? error.message
          : "Unknown sync error",
    });

    await writeSyncLog(
      userId,
      "orders.sync",
      SyncStatus.FAILED,
      error instanceof EbayApiError
        ? JSON.stringify({ status: error.status, body: error.body })
        : error instanceof Error
          ? error.message
          : "Unknown sync error",
      error instanceof EbayApiError
        ? ({ status: error.status, body: error.body } as Prisma.InputJsonValue)
        : undefined,
    );
    throw error;
  }
}

export async function shipOrders(userId: string, requests: ShipRequest[]) {
  const account = await prisma.ebayAccount.findFirst({
    where: { userId, environment: currentEbayEnvironment() },
    orderBy: { updatedAt: "desc" },
  });

  if (!account) {
    throw new Error("eBay 계정이 아직 연결되지 않았습니다.");
  }

  const results = [];

  for (const request of requests) {
    const carrierCode = request.carrierCode.trim();
    const trackingNumber = request.trackingNumber.trim();

    if (!carrierCode || !trackingNumber) {
      results.push({
        orderId: request.orderId,
        ok: false,
        message: "배송사와 운송장 번호는 필수입니다.",
      });
      continue;
    }

    const order = await prisma.order.findFirst({
      where: { id: request.orderId, userId },
      include: { items: true, shipments: true },
    });

    if (!order) {
      results.push({ orderId: request.orderId, ok: false, message: "주문 없음" });
      continue;
    }

    if (order.salesChannel !== SalesChannel.EBAY || !order.ebayOrderId) {
      results.push({
        orderId: order.id,
        ok: false,
        message: "이 배송 API는 eBay 주문만 처리할 수 있습니다.",
      });
      continue;
    }

    const hasCompletedShipment =
      order.fulfillmentStatus === "FULFILLED" ||
      order.shipments.some((shipment) => shipment.status === ShipmentStatus.COMPLETED);

    if (hasCompletedShipment) {
      results.push({
        orderId: order.id,
        ebayOrderId: order.ebayOrderId,
        ok: false,
        message: "이미 배송처리된 주문입니다.",
      });
      continue;
    }

    const lineItems: EbayLineItemReference[] = order.items.map((item) => ({
      lineItemId: item.lineItemId,
      quantity: item.quantity,
    }));

    try {
      const fulfillment = await createShippingFulfillment(
        account,
        order.ebayOrderId,
        lineItems,
        carrierCode,
        trackingNumber,
      );

      await prisma.$transaction([
        prisma.shipment.upsert({
          where: {
            orderId_trackingNumber: {
              orderId: order.id,
              trackingNumber,
            },
          },
          update: {
            carrierCode,
            ebayFulfillmentId: fulfillment.fulfillmentId,
            status: ShipmentStatus.COMPLETED,
            shippedAt: new Date(),
            rawJson: toInputJson(fulfillment),
          },
          create: {
            orderId: order.id,
            carrierCode,
            trackingNumber,
            ebayFulfillmentId: fulfillment.fulfillmentId,
            status: ShipmentStatus.COMPLETED,
            rawJson: toInputJson(fulfillment),
          },
        }),
        prisma.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: "FULFILLED" },
        }),
      ]);

      results.push({
        orderId: order.id,
        ebayOrderId: order.ebayOrderId,
        ok: true,
        message: "배송처리 완료",
      });
    } catch (error) {
      await prisma.shipment.upsert({
        where: {
          orderId_trackingNumber: {
            orderId: order.id,
            trackingNumber,
          },
        },
        update: {
          carrierCode,
          status: ShipmentStatus.FAILED,
          rawJson:
            error instanceof EbayApiError
              ? toInputJson({ status: error.status, body: error.body })
              : undefined,
        },
        create: {
          orderId: order.id,
          carrierCode,
          trackingNumber,
          status: ShipmentStatus.FAILED,
          rawJson:
            error instanceof EbayApiError
              ? toInputJson({ status: error.status, body: error.body })
              : undefined,
        },
      });

      await writeSyncLog(
        userId,
        "shipments.create",
        SyncStatus.FAILED,
        error instanceof EbayApiError
          ? JSON.stringify({ status: error.status, body: error.body })
          : error instanceof Error
            ? error.message
            : "Unknown shipment error",
      );

      results.push({
        orderId: order.id,
        ebayOrderId: order.ebayOrderId,
        ok: false,
        message:
          error instanceof EbayApiError
            ? `eBay API 실패 (${error.status})`
            : error instanceof Error
              ? error.message
              : "배송처리 실패",
      });
    }
  }

  await writeSyncLog(
    userId,
    "shipments.bulk",
    results.every((result) => result.ok) ? SyncStatus.SUCCESS : SyncStatus.PARTIAL,
    JSON.stringify(results),
  );
  await applyOrderAutomationMany(requests.map((request) => request.orderId));

  return results;
}

export async function syncFulfillmentsForOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { ebayAccount: true },
  });

  if (!order?.ebayAccount || order.salesChannel !== SalesChannel.EBAY || !order.ebayOrderId) {
    throw new Error("주문 또는 eBay 계정을 찾을 수 없습니다.");
  }

  const data = await getShippingFulfillments(order.ebayAccount, order.ebayOrderId);
  const fulfillments = data.fulfillments ?? [];

  for (const fulfillment of fulfillments) {
    const record = asRecord(fulfillment);
    const trackingNumber = asString(record.trackingNumber);
    const carrierCode = asString(record.shippingCarrierCode);

    if (!trackingNumber || !carrierCode) {
      continue;
    }

    await prisma.shipment.upsert({
      where: {
        orderId_trackingNumber: {
          orderId: order.id,
          trackingNumber,
        },
      },
      update: {
        carrierCode,
        ebayFulfillmentId: asString(record.fulfillmentId),
        status: ShipmentStatus.COMPLETED,
        rawJson: toInputJson(record),
      },
      create: {
        orderId: order.id,
        carrierCode,
        trackingNumber,
        ebayFulfillmentId: asString(record.fulfillmentId),
        status: ShipmentStatus.COMPLETED,
        rawJson: toInputJson(record),
      },
    });
  }

  await applyOrderAutomation(order.id);

  return { imported: fulfillments.length };
}
