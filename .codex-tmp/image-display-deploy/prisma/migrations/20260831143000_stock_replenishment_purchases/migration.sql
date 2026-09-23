CREATE TABLE IF NOT EXISTS "pocamarket_purchase_jobs" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "order_id" TEXT REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_item_id" TEXT REFERENCES "order_items"("id") ON DELETE CASCADE,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "product_number" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'ORDER_SHORTAGE',
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
);

ALTER TABLE "pocamarket_purchase_jobs"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'ORDER_SHORTAGE',
  ALTER COLUMN "order_id" DROP NOT NULL,
  ALTER COLUMN "order_item_id" DROP NOT NULL;

UPDATE "pocamarket_purchase_jobs"
SET "purpose" = 'ORDER_SHORTAGE'
WHERE "purpose" IS NULL OR "purpose" = '';

CREATE INDEX IF NOT EXISTS "pocamarket_purchase_jobs_user_status_idx"
  ON "pocamarket_purchase_jobs"("user_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "pocamarket_purchase_jobs_product_status_idx"
  ON "pocamarket_purchase_jobs"("product_id", "status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "pocamarket_purchase_jobs_active_item_idx"
  ON "pocamarket_purchase_jobs"("order_item_id")
  WHERE "status" IN ('queued','running','awaiting_confirmation','purchasing');

CREATE UNIQUE INDEX IF NOT EXISTS "pocamarket_purchase_jobs_active_stock_product_idx"
  ON "pocamarket_purchase_jobs"("user_id", "product_id")
  WHERE "order_item_id" IS NULL
    AND "status" IN ('queued','running','awaiting_confirmation','purchasing');
