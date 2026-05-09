import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "order_items"
        ADD COLUMN IF NOT EXISTS "matched_by" TEXT,
        ADD COLUMN IF NOT EXISTS "match_score" DOUBLE PRECISION;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "product_mappings" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL,
        "ebay_item_id" TEXT,
        "ebay_variation_id" TEXT,
        "normalized_title" TEXT,
        "source" TEXT NOT NULL DEFAULT 'manual',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "product_mappings_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_mappings_user_id_ebay_item_id_ebay_variation_id_idx"
        ON "product_mappings"("user_id", "ebay_item_id", "ebay_variation_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_mappings_user_id_ebay_item_id_idx"
        ON "product_mappings"("user_id", "ebay_item_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_mappings_user_id_normalized_title_idx"
        ON "product_mappings"("user_id", "normalized_title");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_mappings_product_id_idx"
        ON "product_mappings"("product_id");
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'product_mappings_user_id_fkey'
        ) THEN
          ALTER TABLE "product_mappings"
            ADD CONSTRAINT "product_mappings_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'product_mappings_product_id_fkey'
        ) THEN
          ALTER TABLE "product_mappings"
            ADD CONSTRAINT "product_mappings_product_id_fkey"
            FOREIGN KEY ("product_id") REFERENCES "products"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$;
    `);

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
