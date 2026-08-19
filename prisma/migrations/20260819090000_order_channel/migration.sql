-- 주문에 판매 채널 개념을 더한다. eBay 전용이던 자리를 채널 공통으로 넓히는 것이
-- 목적이며, 기존 열과 기존 유니크 제약은 그대로 둔다. 되돌릴 수 있어야 하고
-- eBay 동기화가 지금 방식 그대로 계속 돌아야 하기 때문이다.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'EBAY';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "external_order_id" TEXT;

-- 기존 주문은 모두 eBay에서 온 것이므로 그 주문번호를 채널 공통 자리로 옮긴다.
UPDATE "orders" SET "external_order_id" = "ebay_order_id" WHERE "external_order_id" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "external_order_id" SET NOT NULL;

-- 다른 채널 주문은 eBay 주문번호가 없다. 비울 수 있게 한다.
ALTER TABLE "orders" ALTER COLUMN "ebay_order_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_channel_account_external_key"
  ON "orders" ("channel", "ebay_account_id", "external_order_id");
CREATE INDEX IF NOT EXISTS "orders_channel_order_date_idx"
  ON "orders" ("channel", "order_date");
