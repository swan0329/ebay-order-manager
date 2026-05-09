import { Prisma, ShipmentStatus, SyncStatus } from "@/generated/prisma";
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
import { safeLog } from "@/lib/safe-log";

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

function firstStringFromRecord(record: JsonRecord, keys: string[]) {
  return keys.map((key) => asString(record[key])).find(Boolean);
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

  return {
    ebayOrderId: asString(order.orderId) ?? "",
    orderStatus: asString(order.orderStatus) ?? "UNKNOWN",
    fulfillmentStatus: asString(order.orderFulfillmentStatus) ?? "UNKNOWN",
    buyerName: asString(shipTo.fullName) ?? asString(buyer.username),
    buyerUsername: asString(buyer.username),
    buyerCountry: asString(address.countryCode),
    totalAmount: moneyValue(total),
    currency: moneyCurrency(total),
    orderDate: asDate(order.creationDate) ?? new Date(),
    paidAt: asDate(payment.paymentDate),
    modifiedAt: asDate(order.modifiedDate),
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

export function legacyListingReferenceFromOrderItemRaw(rawJson: unknown) {
  const record = asRecord(rawJson);
  const legacyItemId = firstStringFromRecord(record, ["legacyItemId", "itemId"]);

  if (!legacyItemId) {
    return null;
  }

  return {
    legacyItemId,
    legacyVariationId: firstStringFromRecord(record, [
      "legacyVariationId",
      "variationId",
    ]),
    legacyVariationSku: firstStringFromRecord(record, [
      "legacyVariationSku",
      "variationSku",
      "sku",
    ]),
    marketplaceId: firstStringFromRecord(record, [
      "listingMarketplaceId",
      "marketplaceId",
    ]),
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

export async function saveEbayOrder(
  userId: string,
  ebayAccountId: string,
  rawOrder: unknown,
) {
  const parsed = parseEbayOrder(rawOrder);

  if (!parsed.ebayOrderId) {
    throw new Error("eBay order is missing orderId.");
  }

  const order = await prisma.order.upsert({
    where: {
      ebayAccountId_ebayOrderId: {
        ebayAccountId,
        ebayOrderId: parsed.ebayOrderId,
      },
    },
    update: {
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
  const existingItems = await prisma.orderItem.findMany({
    where: { orderId: order.id },
    select: { lineItemId: true, rawJson: true },
  });
  const existingImageByLineItemId = new Map(
    existingItems
      .map((item) => [
        item.lineItemId,
        orderItemImageUrlFromRaw(item.rawJson),
      ] as const)
      .filter(([, imageUrl]) => Boolean(imageUrl)),
  );
  const itemsWithListingImages = await Promise.all(
    parsed.items.map(async (item) => ({
      ...item,
      rawJson: await enrichOrderItemRawWithListingImage({
        ebayOrderId: parsed.ebayOrderId,
        lineItemId: item.lineItemId,
        rawJson: item.rawJson,
        existingImageUrl: existingImageByLineItemId.get(item.lineItemId),
      }),
    })),
  );

  await Promise.all(
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

  await Promise.all(shipmentWrites.filter((write) => write !== null));
  await deductStockForOrder(order.id, userId);
  await applyOrderAutomation(order.id);

  return order;
}

export async function syncOrdersForUser(
  userId: string,
  filters: OrderSyncFilters,
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

  try {
    while (true) {
      const page = await getOrdersFromEbay(account, filters, limit, offset);
      const orders = page.orders ?? [];

      for (const rawOrder of orders) {
        await saveEbayOrder(userId, account.id, rawOrder);
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

    return { imported };
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

  if (!order?.ebayAccount) {
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
