import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "ebay_title" TEXT,
        ADD COLUMN IF NOT EXISTS "description_html" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_price" DECIMAL(12, 2),
        ADD COLUMN IF NOT EXISTS "ebay_image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        ADD COLUMN IF NOT EXISTS "ebay_category_id" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_condition" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_shipping_profile" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_return_profile" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_payment_profile" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_merchant_location_key" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_marketplace_id" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_currency" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_offer_id" TEXT,
        ADD COLUMN IF NOT EXISTS "ebay_item_id" TEXT,
        ADD COLUMN IF NOT EXISTS "listing_status" TEXT,
        ADD COLUMN IF NOT EXISTS "last_uploaded_at" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "upload_error" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "products_listing_status_idx"
        ON "products"("listing_status");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "products_ebay_item_id_idx"
        ON "products"("ebay_item_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "product_upload_jobs" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "product_id" TEXT,
        "sku" TEXT NOT NULL,
        "source" TEXT NOT NULL DEFAULT 'single',
        "action" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "message" TEXT,
        "error" TEXT,
        "raw_json" JSONB,
        "started_at" TIMESTAMP(3),
        "finished_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "product_upload_jobs_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_upload_jobs_user_id_status_created_at_idx"
        ON "product_upload_jobs"("user_id", "status", "created_at");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_upload_jobs_product_id_idx"
        ON "product_upload_jobs"("product_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_upload_jobs_sku_idx"
        ON "product_upload_jobs"("sku");
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'product_upload_jobs_user_id_fkey'
        ) THEN
          ALTER TABLE "product_upload_jobs"
            ADD CONSTRAINT "product_upload_jobs_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'product_upload_jobs_product_id_fkey'
        ) THEN
          ALTER TABLE "product_upload_jobs"
            ADD CONSTRAINT "product_upload_jobs_product_id_fkey"
            FOREIGN KEY ("product_id") REFERENCES "products"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
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
