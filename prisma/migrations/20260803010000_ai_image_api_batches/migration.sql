CREATE TABLE "ai_image_api_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL DEFAULT 'STANDARD',
    "requested_count" INTEGER NOT NULL,
    "claimed_count" INTEGER NOT NULL DEFAULT 0,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT "ai_image_api_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_image_api_batches_mode_check" CHECK ("mode" IN ('STANDARD', 'PRO')),
    CONSTRAINT "ai_image_api_batches_requested_count_check" CHECK ("requested_count" BETWEEN 1 AND 10000),
    CONSTRAINT "ai_image_api_batches_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "ai_image_api_batches_status_created_at_idx"
ON "ai_image_api_batches"("status", "created_at");
