-- eBay의 판매 한도(Selling Limit)를 무료 등록 한도로 쓰던 설정을 없앤다.
-- 무료 등록 한도는 API로 확인할 수 없고, Good 'Til Cancelled 리스팅의 월간
-- 자동 갱신도 등록수수료 대상이라 등록 건수로는 청구액을 맞힐 수 없다.
-- 등록수수료는 eBay 정산(Finances) 거래에 찍힌 INSERTION_FEE만 쓴다.
ALTER TABLE "pricing_settings" DROP COLUMN IF EXISTS "free_listing_allowance";
