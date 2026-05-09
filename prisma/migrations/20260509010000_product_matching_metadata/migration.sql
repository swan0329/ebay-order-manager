ALTER TABLE "order_items"
  ADD COLUMN "matched_by" TEXT,
  ADD COLUMN "match_score" DOUBLE PRECISION;

CREATE TABLE "product_mappings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "ebay_item_id" TEXT,
  "ebay_variation_id" TEXT,
  "normalized_title" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_mappings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_mappings_user_id_ebay_item_id_ebay_variation_id_idx"
  ON "product_mappings"("user_id", "ebay_item_id", "ebay_variation_id");

CREATE INDEX "product_mappings_user_id_ebay_item_id_idx"
  ON "product_mappings"("user_id", "ebay_item_id");

CREATE INDEX "product_mappings_user_id_normalized_title_idx"
  ON "product_mappings"("user_id", "normalized_title");

CREATE INDEX "product_mappings_product_id_idx"
  ON "product_mappings"("product_id");

ALTER TABLE "product_mappings"
  ADD CONSTRAINT "product_mappings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_mappings"
  ADD CONSTRAINT "product_mappings_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
