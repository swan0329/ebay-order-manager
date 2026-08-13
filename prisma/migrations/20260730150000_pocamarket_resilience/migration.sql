ALTER TABLE "pocamarket_sync_settings"
ADD COLUMN "priority_strategy" TEXT NOT NULL DEFAULT 'SMART';

ALTER TABLE "pocamarket_sync_items"
ADD COLUMN "previous_available_count" INTEGER,
ADD COLUMN "previous_is_sold_out" BOOLEAN,
ADD COLUMN "error_code" TEXT,
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "response_adapter" TEXT;

CREATE INDEX "pocamarket_sync_items_error_code_created_at_idx"
ON "pocamarket_sync_items" ("error_code", "created_at");
