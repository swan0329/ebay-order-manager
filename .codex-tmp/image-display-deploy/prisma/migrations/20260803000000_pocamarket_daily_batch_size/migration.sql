ALTER TABLE "pocamarket_sync_settings"
ADD COLUMN "daily_batch_size" INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE "pocamarket_sync_settings"
ADD CONSTRAINT "pocamarket_sync_settings_daily_batch_size_check"
CHECK ("daily_batch_size" BETWEEN 1 AND 10000);
