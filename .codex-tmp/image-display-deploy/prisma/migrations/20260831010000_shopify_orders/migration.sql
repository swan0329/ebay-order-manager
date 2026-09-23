DO $$
BEGIN
  CREATE TYPE "SalesChannel" AS ENUM ('EBAY', 'SHOPIFY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "sales_channel" "SalesChannel" NOT NULL DEFAULT 'EBAY',
  ADD COLUMN IF NOT EXISTS "external_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "order_number" TEXT;

UPDATE "orders"
SET
  "external_order_id" = COALESCE("external_order_id", "ebay_order_id"),
  "order_number" = COALESCE("order_number", "ebay_order_id")
WHERE "external_order_id" IS NULL OR "order_number" IS NULL;

ALTER TABLE "orders"
  ALTER COLUMN "external_order_id" SET NOT NULL,
  ALTER COLUMN "order_number" SET NOT NULL,
  ALTER COLUMN "ebay_order_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_id_sales_channel_external_order_id_key"
  ON "orders"("user_id", "sales_channel", "external_order_id");

CREATE INDEX IF NOT EXISTS "orders_user_id_sales_channel_order_date_idx"
  ON "orders"("user_id", "sales_channel", "order_date");
