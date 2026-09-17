import { procurementPriceLimit } from "@/lib/procurement-price-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { deriveEbayOrderCategory } from "@/lib/ebay-order-status";

export type PocamarketPurchaseJob = {
  id: string;
  userId: string;
  orderId: string | null;
  orderItemId: string | null;
  productId: string;
  productNumber: string;
  requestedQuantity: number;
  referenceUnitPrice: string;
  maxUnitPrice: string;
  status: string;
};

type ProductPurchaseDemand = {
  orderId: string;
  orderItemId: string;
  quantity: number;
};

function isAwaitingShipmentOrder(order: {
  fulfillmentStatus: string;
  rawJson: Prisma.JsonValue | null;
}) {
  const raw = order.rawJson && typeof order.rawJson === "object"
    ? order.rawJson as Record<string, unknown>
    : {};
  const cancelStatus = raw.cancelStatus && typeof raw.cancelStatus === "object"
    ? raw.cancelStatus as Record<string, unknown>
    : {};
  return deriveEbayOrderCategory({
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus:
      typeof raw.orderPaymentStatus === "string" ? raw.orderPaymentStatus : null,
    cancelState:
      typeof cancelStatus.cancelState === "string" ? cancelStatus.cancelState : null,
  }) === "AWAITING_SHIPMENT";
}

export function planProductPurchaseShortages(
  demands: ProductPurchaseDemand[],
  stockQuantity: number,
  existingCoverageByOrderItem: Map<string, number>,
) {
  let remainingStock = Math.max(0, stockQuantity);
  const planned: Array<ProductPurchaseDemand & { requestedQuantity: number }> = [];

  for (const demand of demands) {
    const stockCoverage = Math.min(remainingStock, demand.quantity);
    remainingStock -= stockCoverage;
    const shortage = Math.max(0, demand.quantity - stockCoverage);
    const existingCoverage = Math.max(
      0,
      existingCoverageByOrderItem.get(demand.orderItemId) ?? 0,
    );
    const requestedQuantity = Math.max(0, shortage - existingCoverage);
    if (requestedQuantity > 0) planned.push({ ...demand, requestedQuantity });
  }

  return planned;
}

// The table is owned by Prisma migrations. Bridge routes keep this compatibility
// hook so older phone clients do not need to change their call sequence.
export async function ensurePocamarketPurchaseJobs() {}

export async function createPurchaseJobs(userId: string, orderId: string) {
  await ensurePocamarketPurchaseJobs();
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { fulfillmentStatus: true, rawJson: true } });
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  if (!isAwaitingShipmentOrder(order)) {
    throw new Error("배송대기 주문만 구매 요청할 수 있습니다.");
  }
  const items = await prisma.$queryRaw<Array<{
    orderItemId: string; productId: string; productNumber: string; quantity: number;
    stockQuantity: number; referenceUnitPrice: string | null; fulfillmentStatus: string;
  }>>`
    SELECT oi."id" AS "orderItemId", p."id" AS "productId", p."sku" AS "productNumber",
           oi."quantity", p."stock_quantity" AS "stockQuantity",
           p."sale_price"::text AS "referenceUnitPrice", o."fulfillment_status" AS "fulfillmentStatus"
    FROM "order_items" oi
    JOIN "orders" o ON o."id" = oi."order_id"
    JOIN "products" p ON p."id" = oi."product_id"
    WHERE o."id" = ${orderId} AND o."user_id" = ${userId} AND oi."stock_deducted" = FALSE
  `;
  if (!items.length) throw new Error("구매할 수 있는 매칭 상품이 없습니다.");

  const created: Array<{ id: string; productNumber: string; quantity: number; maxUnitPrice: number }> = [];
  const skipped: string[] = [];
  for (const item of items) {
    const shortage = Math.max(0, item.quantity - item.stockQuantity);
    if (!shortage) continue;
    const referencePrice = Number(item.referenceUnitPrice);
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      skipped.push(`${item.productNumber}: 포카마켓 기준가격 없음`);
      continue;
    }
    const maxPrice = procurementPriceLimit(referencePrice);
    const id = randomUUID();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "pocamarket_purchase_jobs"
        ("id","user_id","order_id","order_item_id","product_id","product_number","requested_quantity","reference_unit_price","max_unit_price")
      VALUES (${id},${userId},${orderId},${item.orderItemId},${item.productId},${item.productNumber},${shortage},${referencePrice},${maxPrice})
      ON CONFLICT DO NOTHING RETURNING "id"
    `;
    if (rows.length) created.push({ id, productNumber: item.productNumber, quantity: shortage, maxUnitPrice: maxPrice });
    else skipped.push(`${item.productNumber}: 이미 구매 작업 진행 중`);
  }
  if (!created.length && !skipped.length) throw new Error("현재 재고 부족 상품이 없습니다.");
  return { created, skipped };
}

export async function createProductPurchaseJob(
  userId: string,
  productId: string,
  requestedQuantity: number,
) {
  await ensurePocamarketPurchaseJobs();
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 20) {
    throw new Error("구매 수량은 1개부터 20개까지 지정할 수 있습니다.");
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      salePrice: true,
      isSoldOut: true,
      pocamarketAvailableCount: true,
    },
  });
  if (!product) throw new Error("상품을 찾을 수 없습니다.");
  if (product.isSoldOut || product.pocamarketAvailableCount === 0) {
    throw new Error("포카마켓에서 품절된 상품은 구매 요청할 수 없습니다.");
  }

  const referencePrice = Number(product.salePrice);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new Error("포카마켓 기준가격이 없어 구매 요청할 수 없습니다.");
  }

  const maxPrice = procurementPriceLimit(referencePrice);
  const id = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "pocamarket_purchase_jobs"
      ("id","user_id","order_id","order_item_id","product_id","product_number","requested_quantity","reference_unit_price","max_unit_price")
    VALUES (${id},${userId},NULL,NULL,${product.id},${product.sku},${requestedQuantity},${referencePrice},${maxPrice})
    ON CONFLICT DO NOTHING RETURNING "id"
  `;
  if (!rows.length) {
    throw new Error("이 상품의 휴대전화 구매 작업이 이미 진행 중입니다.");
  }
  return {
    created: [{
      id,
      productNumber: product.sku,
      quantity: requestedQuantity,
      maxUnitPrice: maxPrice,
    }],
    skipped: [],
  };
}

export function validBridgeToken(request: Request) {
  const expected = process.env.POCAMARKET_BRIDGE_TOKEN?.trim();
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}


export async function retryPurchaseJob(userId: string, id: string, version: string) {
  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<Array<{ id: string; orderId: string | null; orderItemId: string | null; productId: string; status: string; version: string; requestedQuantity: number; purchasedQuantity: number }>>`
      SELECT "id", "order_id" AS "orderId", "order_item_id" AS "orderItemId", "product_id" AS "productId", "status", EXTRACT(EPOCH FROM "updated_at")::text AS "version",
        "requested_quantity" AS "requestedQuantity", "purchased_quantity" AS "purchasedQuantity"
      FROM "pocamarket_purchase_jobs" WHERE "id" = ${id} AND "user_id" = ${userId} FOR UPDATE
    `;
    const job = jobs[0];
    if (!job) throw new Error("구매 요청을 찾을 수 없습니다.");
    if (job.version !== version) throw new Error("구매 상태가 변경되었습니다. 상태를 새로 확인한 뒤 다시 요청해 주세요.");
    if (!["failed", "price_blocked", "cancelled", "awaiting_confirmation"].includes(job.status)) throw new Error("중단되거나 결제 확인 대기 중인 작업만 다시 요청할 수 있습니다.");
    if (job.purchasedQuantity >= job.requestedQuantity) throw new Error("이미 요청 수량을 구매 완료했습니다.");
    // Serialize retries for the same card without resetting its payment history.
    await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${job.productId} FOR UPDATE`;
    const others = await tx.$queryRaw<Array<{ status: string; purchasedQuantity: number; orderItemId: string | null }>>`
      SELECT "status", "purchased_quantity" AS "purchasedQuantity", "order_item_id" AS "orderItemId"
      FROM "pocamarket_purchase_jobs" WHERE "user_id" = ${userId} AND "product_id" = ${job.productId} AND "id" <> ${id}
    `;
    if (others.some(row => ["queued", "running", "purchasing", "awaiting_confirmation"].includes(row.status))) throw new Error("같은 카드의 다른 구매 요청이 진행 중입니다. 해당 요청을 먼저 확인해 주세요.");
    let quantity = job.requestedQuantity;
    if (job.orderId && job.orderItemId) {
      const order = await tx.order.findFirst({where:{id:job.orderId,userId},select:{fulfillmentStatus:true,rawJson:true}});
      if (!order || !isAwaitingShipmentOrder(order)) throw new Error("배송대기 주문만 다시 구매 요청할 수 있습니다.");
      const items = await tx.$queryRaw<Array<{ quantity: number; stockQuantity: number; stockDeducted: boolean }>>`
        SELECT oi."quantity", oi."stock_deducted" AS "stockDeducted", p."stock_quantity" AS "stockQuantity"
        FROM "order_items" oi JOIN "products" p ON p."id" = oi."product_id"
        WHERE oi."id" = ${job.orderItemId} AND oi."product_id" = ${job.productId}
      `;
      const item = items[0];
      const purchasedElsewhere = others.filter(row => row.orderItemId === job.orderItemId).reduce((sum,row)=>sum+row.purchasedQuantity,0);
      const remaining = item && !item.stockDeducted ? Math.max(0,item.quantity-item.stockQuantity-purchasedElsewhere-job.purchasedQuantity) : 0;
      if (!remaining) throw new Error("현재 부족 수량이 없거나 다른 요청에서 이미 구매했습니다.");
      quantity = job.purchasedQuantity + Math.min(remaining,job.requestedQuantity-job.purchasedQuantity);
    }
    await tx.$executeRaw`
      UPDATE "pocamarket_purchase_jobs" SET "status" = 'queued', "requested_quantity" = ${quantity},
        "warning_message" = '관리자가 미구매를 확인하고 재시도 요청함. 기존 허용가격 유지.',
        "error_message" = NULL, "found_unit_price" = NULL, "started_at" = NULL, "completed_at" = NULL,
        "device_serial" = NULL, "updated_at" = NOW() WHERE "id" = ${id}
    `;
    return { id, status: "queued", purchasedQuantity: job.purchasedQuantity, requestedQuantity: quantity };
  });
}
