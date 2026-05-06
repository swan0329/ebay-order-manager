ALTER TABLE "order_items"
ADD COLUMN "product_id" TEXT,
ADD COLUMN "stock_deducted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "products" (
  "id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "internal_code" TEXT,
  "product_name" TEXT NOT NULL,
  "option_name" TEXT,
  "category" TEXT,
  "brand" TEXT,
  "cost_price" DECIMAL(12,2),
  "sale_price" DECIMAL(12,2),
  "stock_quantity" INTEGER NOT NULL DEFAULT 0,
  "safety_stock" INTEGER NOT NULL DEFAULT 0,
  "location" TEXT,
  "memo" TEXT,
  "image_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_movements" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "before_quantity" INTEGER NOT NULL,
  "after_quantity" INTEGER NOT NULL,
  "reason" TEXT,
  "related_order_id" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_status_idx" ON "products"("status");
CREATE INDEX "products_stock_quantity_idx" ON "products"("stock_quantity");
CREATE INDEX "products_product_name_idx" ON "products"("product_name");
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");
CREATE INDEX "order_items_stock_deducted_idx" ON "order_items"("stock_deducted");
CREATE INDEX "inventory_movements_product_id_created_at_idx" ON "inventory_movements"("product_id", "created_at");
CREATE INDEX "inventory_movements_type_idx" ON "inventory_movements"("type");
CREATE INDEX "inventory_movements_related_order_id_idx" ON "inventory_movements"("related_order_id");

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_related_order_id_fkey"
FOREIGN KEY ("related_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
