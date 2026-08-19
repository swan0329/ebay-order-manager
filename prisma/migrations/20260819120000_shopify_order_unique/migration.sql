-- eBay가 아닌 채널의 주문은 eBay 계정 자리가 비어 있다. PostgreSQL은 비어 있는
-- 값을 서로 다른 값으로 보므로 (채널, 계정, 주문번호) 유니크만으로는 같은 주문이
-- 두 번 들어오는 것을 막지 못한다. 그 채널들만 따로 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS "orders_non_ebay_channel_external_key"
  ON "orders" ("channel", "external_order_id")
  WHERE "channel" <> 'EBAY';
