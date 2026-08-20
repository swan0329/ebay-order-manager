CREATE TABLE "automation_rules" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mode" TEXT NOT NULL DEFAULT 'NOTIFY',
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "automation_rules_key_key" ON "automation_rules"("key");

CREATE TABLE "automation_events" (
  "id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "product_id" TEXT,
  "trigger_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "raw_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "automation_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "automation_events_rule_id_trigger_key_key" ON "automation_events"("rule_id", "trigger_key");
CREATE INDEX "automation_events_status_created_at_idx" ON "automation_events"("status", "created_at");
CREATE INDEX "automation_events_product_id_created_at_idx" ON "automation_events"("product_id", "created_at");

INSERT INTO "automation_rules" ("id", "key", "enabled", "mode")
VALUES ('automation_zero_stock_listing', 'ZERO_STOCK_END_LISTING', true, 'NOTIFY')
ON CONFLICT ("key") DO NOTHING;
