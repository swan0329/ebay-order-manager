CREATE TABLE "pocamarket_sync_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "scanned_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "device_serial" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pocamarket_sync_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pocamarket_sync_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_number" TEXT NOT NULL,
    "previous_price" DECIMAL(12,2),
    "observed_price" DECIMAL(12,2),
    "availability" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error_message" TEXT,
    "device_serial" TEXT,
    "observed_at" TIMESTAMP(3),
    "applied_by_id" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pocamarket_sync_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pocamarket_sync_batches_user_id_status_created_at_idx"
ON "pocamarket_sync_batches"("user_id", "status", "created_at");
CREATE UNIQUE INDEX "pocamarket_sync_items_batch_id_product_id_key"
ON "pocamarket_sync_items"("batch_id", "product_id");
CREATE INDEX "pocamarket_sync_items_batch_id_status_idx"
ON "pocamarket_sync_items"("batch_id", "status");
CREATE INDEX "pocamarket_sync_items_product_id_created_at_idx"
ON "pocamarket_sync_items"("product_id", "created_at");

ALTER TABLE "pocamarket_sync_batches"
ADD CONSTRAINT "pocamarket_sync_batches_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pocamarket_sync_items"
ADD CONSTRAINT "pocamarket_sync_items_batch_id_fkey"
FOREIGN KEY ("batch_id") REFERENCES "pocamarket_sync_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pocamarket_sync_items"
ADD CONSTRAINT "pocamarket_sync_items_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pocamarket_sync_items"
ADD CONSTRAINT "pocamarket_sync_items_applied_by_id_fkey"
FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
