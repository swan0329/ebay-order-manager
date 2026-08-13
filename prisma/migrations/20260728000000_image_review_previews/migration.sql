ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'WORKER';

CREATE TABLE IF NOT EXISTS "image_work_assignments" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "worker_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "submitted_at" TIMESTAMPTZ,
  UNIQUE ("product_id")
);

ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ;
ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "rejection_code" TEXT;
ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "result_url" TEXT;
ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "result_key" TEXT;

CREATE INDEX IF NOT EXISTS "image_work_assignments_worker_status_idx"
  ON "image_work_assignments" ("worker_id", "status");

CREATE TABLE IF NOT EXISTS "product_image_history" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "actor_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "image_url" TEXT,
  "previous_urls" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "product_image_history_product_idx"
  ON "product_image_history" ("product_id", "created_at" DESC);
