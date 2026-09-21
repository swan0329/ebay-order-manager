-- 권장가 검토가 어떤 수수료 설정으로 계산됐는지 남긴다. 2026-09-18에 계산식이
-- 국제수수료·주문당 고정비·구매자 배송비·판매세 가산·등록수수료를 쓰기 시작했는데
-- 검토 기록에는 그 값이 없어 나중에 가격 근거를 되짚을 수 없었다.
ALTER TABLE "pricing_reviews"
  ADD COLUMN IF NOT EXISTS "international_fee_rate" DECIMAL(9, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "per_order_fee_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "buyer_shipping_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sales_tax_uplift_rate" DECIMAL(9, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insertion_fee_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0;
