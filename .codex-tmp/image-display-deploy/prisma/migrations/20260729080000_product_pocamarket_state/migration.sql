ALTER TABLE "products"
ADD COLUMN "pocamarket_id" TEXT,
ADD COLUMN "is_sold_out" BOOLEAN NOT NULL DEFAULT false;

UPDATE "products"
SET "pocamarket_id" = NULLIF(BTRIM("sku"), '')
WHERE "pocamarket_id" IS NULL;

CREATE UNIQUE INDEX "products_pocamarket_id_key"
ON "products"("pocamarket_id");
