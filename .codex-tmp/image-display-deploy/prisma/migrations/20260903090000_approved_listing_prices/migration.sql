-- A channel price is an explicitly approved USD amount. Do not backfill this
-- from ebay_price: historic values may be KRW entered in the legacy field.
ALTER TABLE "products"
  ADD COLUMN "final_listing_price_usd" DECIMAL(12, 2),
  ADD COLUMN "final_listing_price_source" TEXT,
  ADD COLUMN "final_listing_price_approved_at" TIMESTAMP(3),
  ADD COLUMN "final_listing_price_approved_by_id" TEXT;

ALTER TABLE "products"
  ADD CONSTRAINT "products_final_listing_price_approved_by_id_fkey"
  FOREIGN KEY ("final_listing_price_approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "products_final_listing_price_usd_idx" ON "products"("final_listing_price_usd");

CREATE TABLE "listing_price_approvals" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "price_usd" DECIMAL(12, 2) NOT NULL,
  "source" TEXT NOT NULL,
  "pricing_review_item_id" TEXT,
  "approved_by_id" TEXT NOT NULL,
  "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_price_approvals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "listing_price_approvals"
  ADD CONSTRAINT "listing_price_approvals_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "listing_price_approvals_pricing_review_item_id_fkey"
  FOREIGN KEY ("pricing_review_item_id") REFERENCES "pricing_review_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "listing_price_approvals_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "listing_price_approvals_product_id_approved_at_idx" ON "listing_price_approvals"("product_id", "approved_at");
CREATE INDEX "listing_price_approvals_pricing_review_item_id_idx" ON "listing_price_approvals"("pricing_review_item_id");
