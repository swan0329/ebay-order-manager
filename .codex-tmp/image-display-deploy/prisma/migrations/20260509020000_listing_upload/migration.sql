ALTER TABLE "products"
  ADD COLUMN "ebay_title" TEXT,
  ADD COLUMN "description_html" TEXT,
  ADD COLUMN "ebay_price" DECIMAL(12, 2),
  ADD COLUMN "ebay_image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ebay_category_id" TEXT,
  ADD COLUMN "ebay_condition" TEXT,
  ADD COLUMN "ebay_shipping_profile" TEXT,
  ADD COLUMN "ebay_return_profile" TEXT,
  ADD COLUMN "ebay_payment_profile" TEXT,
  ADD COLUMN "ebay_merchant_location_key" TEXT,
  ADD COLUMN "ebay_marketplace_id" TEXT,
  ADD COLUMN "ebay_currency" TEXT,
  ADD COLUMN "ebay_offer_id" TEXT,
  ADD COLUMN "ebay_item_id" TEXT,
  ADD COLUMN "listing_status" TEXT,
  ADD COLUMN "last_uploaded_at" TIMESTAMP(3),
  ADD COLUMN "upload_error" TEXT;

CREATE INDEX "products_listing_status_idx" ON "products"("listing_status");
CREATE INDEX "products_ebay_item_id_idx" ON "products"("ebay_item_id");

CREATE TABLE "product_upload_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "product_id" TEXT,
  "sku" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'single',
  "action" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "message" TEXT,
  "error" TEXT,
  "raw_json" JSONB,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_upload_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_upload_jobs_user_id_status_created_at_idx"
  ON "product_upload_jobs"("user_id", "status", "created_at");

CREATE INDEX "product_upload_jobs_product_id_idx"
  ON "product_upload_jobs"("product_id");

CREATE INDEX "product_upload_jobs_sku_idx"
  ON "product_upload_jobs"("sku");

ALTER TABLE "product_upload_jobs"
  ADD CONSTRAINT "product_upload_jobs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_upload_jobs"
  ADD CONSTRAINT "product_upload_jobs_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
