ALTER TABLE "listing_templates"
  ADD COLUMN IF NOT EXISTS "promoted_listing_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "promoted_campaign_id" TEXT,
  ADD COLUMN IF NOT EXISTS "promoted_ad_rate" DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "promoted_funding_model" TEXT;

ALTER TABLE "listing_drafts"
  ADD COLUMN IF NOT EXISTS "promoted_listing_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "promoted_campaign_id" TEXT,
  ADD COLUMN IF NOT EXISTS "promoted_ad_rate" DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "promoted_status" TEXT,
  ADD COLUMN IF NOT EXISTS "promoted_error_summary" TEXT;
