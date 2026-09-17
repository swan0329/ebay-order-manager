CREATE TABLE "variation_listing_states" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "group_key" TEXT NOT NULL,
  "parent_sku" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "ebay_item_id" TEXT,
  "included_product_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "pending_product_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_exported_at" TIMESTAMPTZ,
  "last_confirmed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "variation_listing_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "variation_listing_states_user_id_group_key_key" ON "variation_listing_states"("user_id", "group_key");
CREATE UNIQUE INDEX "variation_listing_states_user_id_parent_sku_key" ON "variation_listing_states"("user_id", "parent_sku");
CREATE INDEX "variation_listing_states_user_id_ebay_item_id_idx" ON "variation_listing_states"("user_id", "ebay_item_id");
