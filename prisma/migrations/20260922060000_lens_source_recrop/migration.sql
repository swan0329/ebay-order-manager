-- 구글렌즈 영역을 다시 잡을 수 있게 원본 사진과 찍었던 네 점을 보관한다.
-- 잘라낸 결과만 남기면 다시 잡을 때 이미 잘린 그림을 또 자르게 되어 카드가
-- 작아지고 모서리가 두 번 둥글려진다. 잘못 좁게 잡은 경우는 아예 넓힐 수 없다.
ALTER TABLE "ai_image_jobs"
  ADD COLUMN IF NOT EXISTS "lens_source_url" TEXT;

-- 네 점은 원본 크기에 대한 비율(0~1)로 저장한다. 화면 크기가 달라져도 그대로 쓴다.
ALTER TABLE "ai_image_jobs"
  ADD COLUMN IF NOT EXISTS "lens_corners_json" JSONB;
