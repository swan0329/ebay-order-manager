CREATE TABLE "product_listings" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "price" DECIMAL(12,2),
  "quantity" INTEGER,
  "status" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_listings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_listings_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_listings_product_id_channel_key"
  ON "product_listings"("product_id", "channel");
CREATE INDEX "product_listings_channel_external_id_idx"
  ON "product_listings"("channel", "external_id");
CREATE INDEX "product_listings_channel_status_idx"
  ON "product_listings"("channel", "status");

-- Prefer the newer upload link where it exists, while retaining Product as the
-- compatibility source. No legacy columns or rows are removed by this migration.
INSERT INTO "product_listings" (
  "id", "product_id", "channel", "external_id", "price", "quantity", "status", "metadata"
)
SELECT
  'pl_' || md5(random()::text || clock_timestamp()::text || p."id"),
  p."id",
  'EBAY',
  COALESCE(l."ebay_item_id", p."ebay_item_id"),
  p."ebay_price",
  GREATEST(p."stock_quantity" - p."safety_stock", 0),
  COALESCE(l."listing_status", p."listing_status"),
  jsonb_strip_nulls(jsonb_build_object(
    'offerId', COALESCE(l."offer_id", p."ebay_offer_id"),
    'source', CASE WHEN l."inventory_id" IS NULL THEN 'products' ELSE 'inventory_listing_links' END
  ))
FROM "products" p
LEFT JOIN "inventory_listing_links" l ON l."inventory_id" = p."id"
WHERE COALESCE(l."ebay_item_id", p."ebay_item_id") IS NOT NULL
ON CONFLICT ("product_id", "channel") DO NOTHING;

INSERT INTO "product_listings" (
  "id", "product_id", "channel", "external_id", "quantity", "status", "metadata"
)
SELECT
  'pl_' || md5(random()::text || clock_timestamp()::text || p."id"),
  p."id",
  'SHOPIFY',
  p."shopify_product_id",
  GREATEST(p."stock_quantity" - p."safety_stock", 0),
  p."shopify_status",
  jsonb_strip_nulls(jsonb_build_object(
    'variantId', p."shopify_variant_id",
    'inventoryItemId', p."shopify_inventory_item_id",
    'source', 'products'
  ))
FROM "products" p
WHERE p."shopify_product_id" IS NOT NULL
ON CONFLICT ("product_id", "channel") DO NOTHING;
