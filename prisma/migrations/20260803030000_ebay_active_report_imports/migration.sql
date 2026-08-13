CREATE TABLE "ebay_report_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "complete_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "unmatched_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "ended_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ebay_report_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ebay_active_listings" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "product_id" TEXT,
    "item_id" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "price" DECIMAL(12,2),
    "quantity" INTEGER,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "match_status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ebay_active_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ebay_active_listings_import_id_item_id_key"
ON "ebay_active_listings"("import_id", "item_id");

CREATE INDEX "ebay_report_imports_user_id_created_at_idx"
ON "ebay_report_imports"("user_id", "created_at");

CREATE INDEX "ebay_active_listings_product_id_created_at_idx"
ON "ebay_active_listings"("product_id", "created_at");

CREATE INDEX "ebay_active_listings_sku_idx"
ON "ebay_active_listings"("sku");

CREATE INDEX "ebay_active_listings_match_status_idx"
ON "ebay_active_listings"("match_status");

ALTER TABLE "ebay_report_imports"
ADD CONSTRAINT "ebay_report_imports_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ebay_active_listings"
ADD CONSTRAINT "ebay_active_listings_import_id_fkey"
FOREIGN KEY ("import_id") REFERENCES "ebay_report_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ebay_active_listings"
ADD CONSTRAINT "ebay_active_listings_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
