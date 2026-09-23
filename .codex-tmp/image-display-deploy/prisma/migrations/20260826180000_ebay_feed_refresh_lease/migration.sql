ALTER TABLE "ebay_feed_jobs"
  ADD COLUMN IF NOT EXISTS "refresh_token" TEXT,
  ADD COLUMN IF NOT EXISTS "refresh_lease_expires_at" TIMESTAMP(3);
