ALTER TABLE "products"
ADD COLUMN "pocamarket_last_attempt_at" TIMESTAMP(3);

UPDATE "products"
SET "pocamarket_last_attempt_at" = "pocamarket_synced_at"
WHERE "pocamarket_synced_at" IS NOT NULL;

CREATE INDEX "products_pocamarket_last_attempt_at_idx"
ON "products" ("pocamarket_last_attempt_at");
