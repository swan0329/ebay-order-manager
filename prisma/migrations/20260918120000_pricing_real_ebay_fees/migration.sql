-- eBay는 상품값뿐 아니라 배송비와 자기가 걷은 판매세에도 수수료를 매기고,
-- 주문마다 고정비를 붙이며, 등록할 때마다 등록수수료를 받는다. 실제 정산에서
-- 확인한 항목들을 계산에 넣을 수 있도록 설정을 늘린다. 기본값 0은 예전 계산과 같다.
ALTER TABLE "pricing_settings"
  ADD COLUMN IF NOT EXISTS "international_fee_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "per_order_fee_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "buyer_shipping_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sales_tax_uplift_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insertion_fee_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "free_listing_allowance" INTEGER NOT NULL DEFAULT 250;
