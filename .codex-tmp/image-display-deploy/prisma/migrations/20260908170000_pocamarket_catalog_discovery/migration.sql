CREATE TABLE IF NOT EXISTS "pocamarket_catalog_states" (
  "group_id" INTEGER PRIMARY KEY CHECK ("group_id" IN (2, 3)),
  "brand" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "next_page" INTEGER NOT NULL DEFAULT 1,
  "total_count" INTEGER NOT NULL DEFAULT 0,
  "scanned_count" INTEGER NOT NULL DEFAULT 0,
  "created_count" INTEGER NOT NULL DEFAULT 0,
  "total_created" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "lease_token" TEXT,
  "lease_until" TIMESTAMPTZ,
  "last_completed_at" TIMESTAMPTZ,
  "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO "pocamarket_catalog_states" ("group_id", "brand") VALUES
  (2, 'BTS'), (3, 'Stray Kids') ON CONFLICT ("group_id") DO NOTHING;
