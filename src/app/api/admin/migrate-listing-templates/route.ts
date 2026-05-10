import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "listing_templates" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "marketplace_id" TEXT,
        "category_id" TEXT,
        "condition" TEXT,
        "condition_description" TEXT,
        "listing_duration" TEXT,
        "listing_format" TEXT,
        "currency" TEXT,
        "default_quantity" INTEGER,
        "default_price" DECIMAL(12,2),
        "payment_policy_id" TEXT,
        "fulfillment_policy_id" TEXT,
        "return_policy_id" TEXT,
        "merchant_location_key" TEXT,
        "best_offer_enabled" BOOLEAN NOT NULL DEFAULT false,
        "minimum_offer_price" DECIMAL(12,2),
        "auto_accept_price" DECIMAL(12,2),
        "private_listing" BOOLEAN NOT NULL DEFAULT false,
        "immediate_pay_required" BOOLEAN NOT NULL DEFAULT false,
        "description_template_html" TEXT,
        "item_specifics_template_json" JSONB,
        "image_settings_json" JSONB,
        "shipping_settings_json" JSONB,
        "sku_settings_json" JSONB,
        "is_default" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "listing_templates_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_upload_jobs"
        ADD COLUMN IF NOT EXISTS "template_id" TEXT,
        ADD COLUMN IF NOT EXISTS "error_summary" TEXT,
        ADD COLUMN IF NOT EXISTS "raw_ebay_error" JSONB,
        ADD COLUMN IF NOT EXISTS "final_payload_json" JSONB;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "upload_error_summary" TEXT,
        ADD COLUMN IF NOT EXISTS "upload_raw_error" JSONB;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "listing_templates"
        ADD COLUMN IF NOT EXISTS "title_template" TEXT,
        ADD COLUMN IF NOT EXISTS "excluded_locations_json" JSONB;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "listing_drafts" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "source_inventory_id" TEXT,
        "template_id" TEXT,
        "sku" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "subtitle" TEXT,
        "description_html" TEXT,
        "price" DECIMAL(12,2),
        "quantity" INTEGER,
        "image_urls_json" JSONB,
        "category_id" TEXT,
        "condition" TEXT,
        "condition_description" TEXT,
        "item_specifics_json" JSONB,
        "marketplace_id" TEXT,
        "currency" TEXT,
        "payment_policy_id" TEXT,
        "fulfillment_policy_id" TEXT,
        "return_policy_id" TEXT,
        "merchant_location_key" TEXT,
        "best_offer_enabled" BOOLEAN NOT NULL DEFAULT false,
        "minimum_offer_price" DECIMAL(12,2),
        "auto_accept_price" DECIMAL(12,2),
        "private_listing" BOOLEAN NOT NULL DEFAULT false,
        "immediate_pay_required" BOOLEAN NOT NULL DEFAULT false,
        "listing_format" TEXT,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "ebay_item_id" TEXT,
        "offer_id" TEXT,
        "listing_status" TEXT,
        "error_summary" TEXT,
        "raw_error_json" JSONB,
        "validation_json" JSONB,
        "field_source_json" JSONB,
        "last_uploaded_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "listing_drafts_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "listing_drafts"
        ADD COLUMN IF NOT EXISTS "field_source_json" JSONB;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ebay_policy_caches" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "policy_type" TEXT NOT NULL,
        "policy_id" TEXT NOT NULL,
        "name" TEXT,
        "marketplace_id" TEXT,
        "raw_json" JSONB,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ebay_policy_caches_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ebay_inventory_location_caches" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "merchant_location_key" TEXT NOT NULL,
        "name" TEXT,
        "address_summary" TEXT,
        "raw_json" JSONB,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ebay_inventory_location_caches_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "inventory_listing_links" (
        "id" TEXT NOT NULL,
        "inventory_id" TEXT NOT NULL,
        "sku" TEXT NOT NULL,
        "ebay_item_id" TEXT,
        "offer_id" TEXT,
        "listing_status" TEXT,
        "last_uploaded_at" TIMESTAMP(3),
        "last_synced_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "inventory_listing_links_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_drafts_user_id_status_updated_at_idx"
        ON "listing_drafts"("user_id", "status", "updated_at");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_drafts_source_inventory_id_idx"
        ON "listing_drafts"("source_inventory_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_drafts_template_id_idx"
        ON "listing_drafts"("template_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_drafts_sku_idx"
        ON "listing_drafts"("sku");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ebay_policy_caches_user_id_policy_type_policy_id_marketplace_id_key"
        ON "ebay_policy_caches"("user_id", "policy_type", "policy_id", "marketplace_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ebay_inventory_location_caches_user_id_merchant_location_key_key"
        ON "ebay_inventory_location_caches"("user_id", "merchant_location_key");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "inventory_listing_links_inventory_id_key"
        ON "inventory_listing_links"("inventory_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "inventory_listing_links_listing_status_idx"
        ON "inventory_listing_links"("listing_status");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_templates_user_id_is_default_idx"
        ON "listing_templates"("user_id", "is_default");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "listing_templates_user_id_name_idx"
        ON "listing_templates"("user_id", "name");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "listing_templates_one_default_per_user_idx"
        ON "listing_templates"("user_id") WHERE "is_default" = true;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_upload_jobs_template_id_idx"
        ON "product_upload_jobs"("template_id");
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'listing_templates_user_id_fkey'
        ) THEN
          ALTER TABLE "listing_templates"
            ADD CONSTRAINT "listing_templates_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'product_upload_jobs_template_id_fkey'
        ) THEN
          ALTER TABLE "product_upload_jobs"
            ADD CONSTRAINT "product_upload_jobs_template_id_fkey"
            FOREIGN KEY ("template_id") REFERENCES "listing_templates"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'listing_drafts_user_id_fkey'
        ) THEN
          ALTER TABLE "listing_drafts"
            ADD CONSTRAINT "listing_drafts_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'listing_drafts_source_inventory_id_fkey'
        ) THEN
          ALTER TABLE "listing_drafts"
            ADD CONSTRAINT "listing_drafts_source_inventory_id_fkey"
            FOREIGN KEY ("source_inventory_id") REFERENCES "products"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'listing_drafts_template_id_fkey'
        ) THEN
          ALTER TABLE "listing_drafts"
            ADD CONSTRAINT "listing_drafts_template_id_fkey"
            FOREIGN KEY ("template_id") REFERENCES "listing_templates"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ebay_policy_caches_user_id_fkey'
        ) THEN
          ALTER TABLE "ebay_policy_caches"
            ADD CONSTRAINT "ebay_policy_caches_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ebay_inventory_location_caches_user_id_fkey'
        ) THEN
          ALTER TABLE "ebay_inventory_location_caches"
            ADD CONSTRAINT "ebay_inventory_location_caches_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'inventory_listing_links_inventory_id_fkey'
        ) THEN
          ALTER TABLE "inventory_listing_links"
            ADD CONSTRAINT "inventory_listing_links_inventory_id_fkey"
            FOREIGN KEY ("inventory_id") REFERENCES "products"("id")
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
