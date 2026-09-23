ALTER TABLE "products"
ADD COLUMN "pocamarket_available_count" INTEGER;

ALTER TABLE "pocamarket_sync_items"
ADD COLUMN "observed_available_count" INTEGER;

ALTER TABLE "products"
ADD CONSTRAINT "products_pocamarket_available_count_nonnegative"
CHECK ("pocamarket_available_count" IS NULL OR "pocamarket_available_count" >= 0);

ALTER TABLE "pocamarket_sync_items"
ADD CONSTRAINT "pocamarket_sync_items_observed_available_count_nonnegative"
CHECK ("observed_available_count" IS NULL OR "observed_available_count" >= 0);
