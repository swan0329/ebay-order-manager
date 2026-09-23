-- Emergency stop requested by the administrator: preserve completed external
-- publishes and prevent every not-yet-started item from being sent.
UPDATE "channel_publish_items"
SET
  "status" = 'FAILED',
  "error" = '사용자가 등록 작업을 중단했습니다.',
  "completed_at" = NOW(),
  "updated_at" = NOW()
WHERE "status" = 'QUEUED'
  AND "job_id" IN (
    SELECT "id"
    FROM "channel_publish_jobs"
    WHERE "status" NOT IN ('COMPLETED', 'COMPLETED_WITH_ERROR', 'FAILED', 'CANCELLED')
  );

UPDATE "channel_publish_jobs"
SET
  "status" = 'CANCELLED',
  "active_key" = NULL,
  "completed_at" = NOW(),
  "updated_at" = NOW()
WHERE "status" NOT IN ('COMPLETED', 'COMPLETED_WITH_ERROR', 'FAILED', 'CANCELLED');
