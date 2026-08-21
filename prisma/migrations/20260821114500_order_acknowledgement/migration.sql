ALTER TABLE "orders" ADD COLUMN "acknowledged_at" TIMESTAMP(3);
CREATE INDEX "orders_user_id_acknowledged_at_order_date_idx"
  ON "orders"("user_id", "acknowledged_at", "order_date");
