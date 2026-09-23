ALTER TABLE "channel_publish_jobs"
  ADD COLUMN "worker_token" TEXT,
  ADD COLUMN "worker_lease_expires_at" TIMESTAMP(3);
