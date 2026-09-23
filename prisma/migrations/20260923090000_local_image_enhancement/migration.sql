-- Local GPU enhancement is an explicit second stage after dewatermarking.
-- These base tables existed in legacy runtime setup code; create them here too
-- so a fresh deployment never depends on an application request to create data.
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
  UNIQUE("product_id")
);
CREATE TABLE IF NOT EXISTS "image_workbench_settings" (
  "user_id" TEXT PRIMARY KEY,
  "brightness" INTEGER NOT NULL DEFAULT 8,
  "contrast" INTEGER NOT NULL DEFAULT 3,
  "saturation" INTEGER NOT NULL DEFAULT 5,
  "sharpness" INTEGER NOT NULL DEFAULT 12,
  "watermark_strength" INTEGER NOT NULL DEFAULT 110,
  "local_ai_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing review URLs and approved images remain untouched.
ALTER TABLE "ai_image_jobs"
  ADD COLUMN IF NOT EXISTS "dewatermark_url" TEXT,
  ADD COLUMN IF NOT EXISTS "enhancement_model" TEXT,
  ADD COLUMN IF NOT EXISTS "enhancement_scale" INTEGER,
  ADD COLUMN IF NOT EXISTS "enhancement_strength" INTEGER,
  ADD COLUMN IF NOT EXISTS "enhancement_started_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "enhancement_completed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "dewatermark_cleanup_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "dewatermark_cleanup_error" TEXT;

CREATE INDEX IF NOT EXISTS "ai_image_jobs_enhancement_queue_idx"
  ON "ai_image_jobs" ("status", "created_at")
  WHERE "status" = 'enhancement_queued';

ALTER TABLE "image_workbench_settings"
  ADD COLUMN IF NOT EXISTS "enhancement_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "enhancement_model" TEXT NOT NULL DEFAULT 'RealESRGAN_x2plus',
  ADD COLUMN IF NOT EXISTS "enhancement_scale" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "enhancement_strength" INTEGER NOT NULL DEFAULT 45;
