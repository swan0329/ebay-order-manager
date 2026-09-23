CREATE INDEX IF NOT EXISTS "orders_user_id_fulfillment_status_order_date_idx"
  ON "orders" ("user_id", "fulfillment_status", "order_date");

CREATE INDEX IF NOT EXISTS "orders_user_id_order_date_idx"
  ON "orders" ("user_id", "order_date");
