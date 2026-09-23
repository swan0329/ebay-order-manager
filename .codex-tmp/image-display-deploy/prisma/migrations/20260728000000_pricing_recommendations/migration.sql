CREATE TABLE "pricing_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "domestic_shipping_krw" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "buying_agency_fee_krw" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "exchange_rate_krw_per_usd" DECIMAL(12,4) NOT NULL,
    "target_margin_rate" DECIMAL(9,6) NOT NULL,
    "ebay_fee_rate" DECIMAL(9,6) NOT NULL,
    "advertising_rate" DECIMAL(9,6) NOT NULL,
    "minimum_sale_price_usd" DECIMAL(12,2),
    "rounding_increment_usd" DECIMAL(12,2) NOT NULL DEFAULT 0.10,
    "allocation_method" TEXT NOT NULL DEFAULT 'PER_CARD_FIXED',
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "pricing_reviews" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "domestic_shipping_krw" DECIMAL(12,2) NOT NULL,
    "buying_agency_fee_krw" DECIMAL(12,2) NOT NULL,
    "exchange_rate_krw_per_usd" DECIMAL(12,4) NOT NULL,
    "target_margin_rate" DECIMAL(9,6) NOT NULL,
    "ebay_fee_rate" DECIMAL(9,6) NOT NULL,
    "advertising_rate" DECIMAL(9,6) NOT NULL,
    "minimum_sale_price_usd" DECIMAL(12,2),
    "rounding_increment_usd" DECIMAL(12,2) NOT NULL,
    "allocation_method" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_reviews_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "pricing_review_items" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "poca_price_krw" DECIMAL(12,2) NOT NULL,
    "total_cost_krw" DECIMAL(12,2) NOT NULL,
    "cost_usd" DECIMAL(16,6) NOT NULL,
    "raw_recommended_price_usd" DECIMAL(16,6) NOT NULL,
    "recommended_price_usd" DECIMAL(12,2) NOT NULL,
    "expected_proceeds_usd" DECIMAL(16,6) NOT NULL,
    "expected_net_margin_usd" DECIMAL(16,6) NOT NULL,
    "expected_net_margin_rate" DECIMAL(16,6) NOT NULL,
    "applied_draft_id" TEXT,
    "applied_by_id" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_review_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pricing_reviews_status_created_at_idx" ON "pricing_reviews"("status", "created_at");
CREATE UNIQUE INDEX "pricing_review_items_review_id_product_id_key" ON "pricing_review_items"("review_id", "product_id");
CREATE INDEX "pricing_review_items_product_id_created_at_idx" ON "pricing_review_items"("product_id", "created_at");
CREATE INDEX "pricing_review_items_applied_draft_id_idx" ON "pricing_review_items"("applied_draft_id");
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_reviews" ADD CONSTRAINT "pricing_reviews_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_reviews" ADD CONSTRAINT "pricing_reviews_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_review_items" ADD CONSTRAINT "pricing_review_items_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "pricing_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_review_items" ADD CONSTRAINT "pricing_review_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_review_items" ADD CONSTRAINT "pricing_review_items_applied_draft_id_fkey" FOREIGN KEY ("applied_draft_id") REFERENCES "listing_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pricing_review_items" ADD CONSTRAINT "pricing_review_items_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
