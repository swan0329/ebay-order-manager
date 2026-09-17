ALTER TABLE "variation_thumbnail_settings"
  ADD COLUMN IF NOT EXISTS "variation_watermark_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
  ADD COLUMN IF NOT EXISTS "variation_watermark_logo_size" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "variation_watermark_gap" INTEGER NOT NULL DEFAULT 25;

-- Existing accounts keep the watermark appearance they had before the settings split.
UPDATE "variation_thumbnail_settings"
SET "variation_watermark_opacity" = "watermark_opacity",
    "variation_watermark_logo_size" = "watermark_logo_size",
    "variation_watermark_gap" = "watermark_gap";
