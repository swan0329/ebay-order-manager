CREATE TABLE "listing_templates" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "marketplace_id" TEXT,
  "category_id" TEXT,
  "condition" TEXT,
  "condition_description" TEXT,
  "listing_duration" TEXT,
  "listing_format" TEXT,
  "currency" TEXT,
  "default_quantity" INTEGER,
  "default_price" DECIMAL(12,2),
  "payment_policy_id" TEXT,
  "fulfillment_policy_id" TEXT,
  "return_policy_id" TEXT,
  "merchant_location_key" TEXT,
  "best_offer_enabled" BOOLEAN NOT NULL DEFAULT false,
  "minimum_offer_price" DECIMAL(12,2),
  "auto_accept_price" DECIMAL(12,2),
  "private_listing" BOOLEAN NOT NULL DEFAULT false,
  "immediate_pay_required" BOOLEAN NOT NULL DEFAULT false,
  "description_template_html" TEXT,
  "item_specifics_template_json" JSONB,
  "image_settings_json" JSONB,
  "shipping_settings_json" JSONB,
  "sku_settings_json" JSONB,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "listing_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_upload_jobs" ADD COLUMN "template_id" TEXT;
ALTER TABLE "product_upload_jobs" ADD COLUMN "error_summary" TEXT;
ALTER TABLE "product_upload_jobs" ADD COLUMN "raw_ebay_error" JSONB;
ALTER TABLE "product_upload_jobs" ADD COLUMN "final_payload_json" JSONB;

CREATE INDEX "listing_templates_user_id_is_default_idx" ON "listing_templates"("user_id", "is_default");
CREATE INDEX "listing_templates_user_id_name_idx" ON "listing_templates"("user_id", "name");
CREATE UNIQUE INDEX "listing_templates_one_default_per_user_idx" ON "listing_templates"("user_id") WHERE "is_default" = true;
CREATE INDEX "product_upload_jobs_template_id_idx" ON "product_upload_jobs"("template_id");

ALTER TABLE "listing_templates" ADD CONSTRAINT "listing_templates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_upload_jobs" ADD CONSTRAINT "product_upload_jobs_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "listing_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
