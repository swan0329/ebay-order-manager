CREATE TABLE IF NOT EXISTS "ai_image_jobs" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "source_url" TEXT NOT NULL,
  "preview_url" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ,
  "reviewed_at" TIMESTAMPTZ,
  "reviewed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  UNIQUE ("product_id")
);

CREATE INDEX IF NOT EXISTS "ai_image_jobs_status_idx"
  ON "ai_image_jobs"("status", "created_at");

ALTER TABLE "ai_image_jobs"
  ADD COLUMN IF NOT EXISTS "api_batch_id" TEXT
  REFERENCES "ai_image_api_batches"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "ai_image_jobs_api_batch_recovery_idx"
  ON "ai_image_jobs"("api_batch_id", "status", "processed_at");
