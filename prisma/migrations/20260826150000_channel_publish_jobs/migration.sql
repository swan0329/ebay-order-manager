CREATE TABLE "channel_publish_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'UPSERT',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "total_count" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "channel_publish_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "channel_publish_items" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "external_id" TEXT,
  "error" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "channel_publish_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "channel_publish_jobs_user_id_status_created_at_idx" ON "channel_publish_jobs"("user_id", "status", "created_at");
CREATE INDEX "channel_publish_jobs_status_created_at_idx" ON "channel_publish_jobs"("status", "created_at");
CREATE UNIQUE INDEX "channel_publish_items_job_id_target_type_target_id_key" ON "channel_publish_items"("job_id", "target_type", "target_id");
CREATE INDEX "channel_publish_items_job_id_status_created_at_idx" ON "channel_publish_items"("job_id", "status", "created_at");

ALTER TABLE "channel_publish_jobs" ADD CONSTRAINT "channel_publish_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_publish_items" ADD CONSTRAINT "channel_publish_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "channel_publish_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
