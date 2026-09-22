-- 판매가 계산에 빠져 있던 실제 비용을 넣는다.
-- 지금까지는 구매자에게 받는 배송비만 있고 실제로 배송에 드는 돈이 없어, 받는 돈보다
-- 더 들면 그 차액이 어디에도 나타나지 않고 조용히 손해가 됐다. 포장재와 환전 수수료도
-- 마찬가지다.
ALTER TABLE "pricing_settings"
  ADD COLUMN IF NOT EXISTS "shipping_cost_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "packaging_cost_krw" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "fx_fee_rate" DECIMAL(9, 6) NOT NULL DEFAULT 0;
