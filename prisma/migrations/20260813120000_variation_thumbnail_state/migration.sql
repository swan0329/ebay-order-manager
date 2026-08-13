ALTER TABLE "variation_listing_states"
  ADD COLUMN "thumbnail_status" TEXT NOT NULL DEFAULT 'MISSING',
  ADD COLUMN "thumbnail_url" TEXT,
  ADD COLUMN "thumbnail_key" TEXT,
  ADD COLUMN "thumbnail_hash" TEXT,
  ADD COLUMN "thumbnail_product_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "thumbnail_error" TEXT,
  ADD COLUMN "thumbnail_generated_at" TIMESTAMPTZ;

CREATE INDEX "variation_listing_states_user_id_thumbnail_status_idx"
  ON "variation_listing_states"("user_id", "thumbnail_status");

CREATE TABLE IF NOT EXISTS "variation_thumbnail_settings" (
  "user_id" TEXT NOT NULL,
  "logo_url" TEXT,
  "logo_key" TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "variation_thumbnail_settings_pkey" PRIMARY KEY ("user_id")
);
