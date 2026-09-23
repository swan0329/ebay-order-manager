DROP INDEX IF EXISTS "ebay_active_listings_import_id_item_id_key";

CREATE UNIQUE INDEX "ebay_active_listings_import_id_item_id_sku_key"
ON "ebay_active_listings"("import_id", "item_id", "sku");
