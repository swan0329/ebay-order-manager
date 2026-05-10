ALTER TABLE "products"
  ADD COLUMN "upload_error_summary" TEXT,
  ADD COLUMN "upload_raw_error" JSONB;
