import { randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { deriveEbayOrderCategory } from "@/lib/ebay-order-status";

export type PocamarketPurchaseJob = {
  id: string;
  userId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  productNumber: string;
  requestedQuantity: number;
  referenceUnitPrice: string;
  maxUnitPrice: string;
  status: string;
};

let schemaReady: Promise<void> | null = null;

export function ensurePocamarketPurchaseJobs() {
  if (schemaReady) return schemaReady;
  schemaReady = ensurePocamarketPurchaseJobsOnce().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

async function ensurePocamarketPurchaseJobsOnce() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "pocamarket_purchase_jobs" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "order_item_id" TEXT NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
      "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "product_number" TEXT NOT NULL,
      "requested_quantity" INTEGER NOT NULL CHECK ("requested_quantity" > 0),
      "reference_unit_price" NUMERIC(12,2) NOT NULL,
      "max_unit_price" NUMERIC(12,2) NOT NULL,
      "allow_multiple_sellers" BOOLEAN NOT NULL DEFAULT TRUE,
      "require_checkout_confirmation" BOOLEAN NOT NULL DEFAULT TRUE,
      "status" TEXT NOT NULL DEFAULT 'queued',
      "found_unit_price" NUMERIC(12,2),
      "purchased_quantity" INTEGER NOT NULL DEFAULT 0,
      "market_order_number" TEXT,
      "warning_message" TEXT,
      "error_message" TEXT,
      "device_serial" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "started_at" TIMESTAMPTZ,
      "confirmation_requested_at" TIMESTAMPTZ,
      "completed_at" TIMESTAMPTZ,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "pocamarket_purchase_jobs_user_status_idx" ON "pocamarket_purchase_jobs" ("user_id", "status", "created_at")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "pocamarket_purchase_jobs_active_item_idx" ON "pocamarket_purchase_jobs" ("order_item_id") WHERE "status" IN ('queued','running','awaiting_confirmation','purchasing')`);
}

export async function createPurchaseJobs(userId: string, orderId: string) {
  await ensurePocamarketPurchaseJobs();
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { fulfillmentStatus: true, rawJson: true } });
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  const raw = order.rawJson && typeof order.rawJson === "object" ? order.rawJson as Record<string, unknown> : {};
  const cancelStatus = raw.cancelStatus && typeof raw.cancelStatus === "object" ? raw.cancelStatus as Record<string, unknown> : {};
  if (deriveEbayOrderCategory({
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: typeof raw.orderPaymentStatus === "string" ? raw.orderPaymentStatus : null,
    cancelState: typeof cancelStatus.cancelState === "string" ? cancelStatus.cancelState : null,
  }) !== "AWAITING_SHIPMENT") throw new Error("배송대기 주문만 구매 요청할 수 있습니다.");
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
    const maxPrice = Math.round(referencePrice * 1.2);
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

export function validBridgeToken(request: Request) {
  const expected = process.env.POCAMARKET_BRIDGE_TOKEN?.trim();
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
