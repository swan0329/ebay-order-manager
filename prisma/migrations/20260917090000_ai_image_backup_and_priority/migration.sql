-- 구글렌즈 결과로 바꾼 뒤 AI가 만든 직전 결과로 되돌릴 수 있게 보관한다.
ALTER TABLE "ai_image_jobs"
  ADD COLUMN IF NOT EXISTS "backup_preview_url" TEXT;

-- 사람이 고른 상품을 먼저 처리한다. 값이 클수록 먼저 처리한다.
ALTER TABLE "ai_image_jobs"
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;

-- 대기 작업 선택은 우선순위 → 담은 시각 → 상품번호 순서로 본다.
CREATE INDEX IF NOT EXISTS "ai_image_jobs_queue_order_idx"
  ON "ai_image_jobs" ("status", "priority" DESC, "created_at");
