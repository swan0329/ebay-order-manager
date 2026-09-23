ALTER TABLE "variation_thumbnail_settings"
  ADD COLUMN IF NOT EXISTS "image_rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "image_zoom" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "image_flip_horizontal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "background_color" TEXT NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN IF NOT EXISTS "padding_top" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS "padding_right" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS "padding_bottom" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS "padding_left" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS "shadow_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shadow_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS "shadow_blur" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "shadow_offset_x" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "shadow_offset_y" INTEGER NOT NULL DEFAULT 12;

UPDATE "variation_thumbnail_settings"
SET "padding_top" = "background_padding",
    "padding_right" = "background_padding",
    "padding_bottom" = "background_padding",
    "padding_left" = "background_padding";
