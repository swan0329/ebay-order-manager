CREATE TABLE "ebay_active_report_syncs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ebay_task_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "error_message" TEXT,
  "report_import_id" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ebay_active_report_syncs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ebay_active_report_syncs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ebay_active_report_syncs_ebay_task_id_key"
  ON "ebay_active_report_syncs"("ebay_task_id");
CREATE INDEX "ebay_active_report_syncs_user_id_status_requested_at_idx"
  ON "ebay_active_report_syncs"("user_id", "status", "requested_at");
