ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "shopify_product_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_variant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_inventory_item_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_status" TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_last_uploaded_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shopify_upload_error" TEXT;

CREATE INDEX IF NOT EXISTS "products_shopify_product_id_idx"
  ON "products" ("shopify_product_id");
