import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "source_image_url" TEXT,
        ADD COLUMN IF NOT EXISTS "user_front_image_url" TEXT,
        ADD COLUMN IF NOT EXISTS "user_back_image_url" TEXT,
        ADD COLUMN IF NOT EXISTS "user_front_r2_key" TEXT,
        ADD COLUMN IF NOT EXISTS "user_back_r2_key" TEXT,
        ADD COLUMN IF NOT EXISTS "image_source" TEXT DEFAULT 'pocamarket',
        ADD COLUMN IF NOT EXISTS "has_back_image" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "matched_by" TEXT,
        ADD COLUMN IF NOT EXISTS "match_confidence" DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "image_signature" JSONB,
        ADD COLUMN IF NOT EXISTS "image_phash" TEXT,
        ADD COLUMN IF NOT EXISTS "image_dhash" TEXT,
        ADD COLUMN IF NOT EXISTS "image_ahash" TEXT,
        ADD COLUMN IF NOT EXISTS "orb_descriptor_path" TEXT,
        ADD COLUMN IF NOT EXISTS "image_width" INTEGER,
        ADD COLUMN IF NOT EXISTS "image_height" INTEGER,
        ADD COLUMN IF NOT EXISTS "image_fingerprint_updated_at" TIMESTAMP(3);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "products"
        ALTER COLUMN "image_source" DROP NOT NULL;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "products_image_source_idx"
        ON "products" ("image_source");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "products_sku_id_idx"
        ON "products" ("sku", "id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "products_stock_status_idx"
        ON "products" ("stock_quantity", "status");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_drafts_source_inventory_id_user_id_updated_at_idx"
        ON "listing_drafts" ("source_inventory_id", "user_id", "updated_at");
    `);

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
