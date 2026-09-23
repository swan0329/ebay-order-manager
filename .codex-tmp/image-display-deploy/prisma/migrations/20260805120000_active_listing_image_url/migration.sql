-- 활성상품 리스팅의 대표 이미지 주소를 저장한다. 연결 화면에서 eBay 카드 사진과
-- 프로그램 상품 사진을 나란히 보고 짝을 고르기 위한 값이며, 한 번 받아오면
-- 다시 eBay를 부르지 않도록 여기에 남긴다.
ALTER TABLE "ebay_active_listings"
  ADD COLUMN IF NOT EXISTS "image_url" TEXT;
