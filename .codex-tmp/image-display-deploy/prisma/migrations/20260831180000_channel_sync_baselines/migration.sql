ALTER TABLE "products"
ADD COLUMN "ebay_last_synced_price" DECIMAL(12,2),
ADD COLUMN "ebay_last_synced_quantity" INTEGER,
ADD COLUMN "shopify_last_synced_price" DECIMAL(12,2),
ADD COLUMN "shopify_last_synced_quantity" INTEGER;

ALTER TABLE "channel_publish_jobs"
ADD COLUMN "active_key" TEXT;

CREATE UNIQUE INDEX "channel_publish_jobs_active_key_key"
ON "channel_publish_jobs"("active_key");
