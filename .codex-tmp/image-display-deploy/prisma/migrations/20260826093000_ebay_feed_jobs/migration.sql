CREATE TABLE "ebay_feed_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "feed_type" TEXT NOT NULL,
    "ebay_task_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "targets_json" JSONB NOT NULL,
    "failures_json" JSONB,
    "external_status" JSONB,
    "error" TEXT,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebay_feed_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ebay_feed_jobs_idempotency_key_key" ON "ebay_feed_jobs"("idempotency_key");
CREATE UNIQUE INDEX "ebay_feed_jobs_ebay_task_id_key" ON "ebay_feed_jobs"("ebay_task_id");
CREATE INDEX "ebay_feed_jobs_user_id_status_created_at_idx" ON "ebay_feed_jobs"("user_id", "status", "created_at");

ALTER TABLE "ebay_feed_jobs"
ADD CONSTRAINT "ebay_feed_jobs_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
