-- 사람이 리스팅을 상품에 연결한 시각. 방금 한 연결을 최신순으로 되짚어
-- 잘못된 것을 풀 수 있게 하기 위한 값이다. 기존 행은 값이 없으므로,
-- 조회 쪽에서 상품의 수정 시각으로 대신 정렬한다.
ALTER TABLE "ebay_active_listings"
  ADD COLUMN IF NOT EXISTS "linked_at" TIMESTAMP(3);
