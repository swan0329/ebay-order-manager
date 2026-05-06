ALTER TABLE "orders"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "warning_level" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "warning_message" TEXT,
  ADD COLUMN "automation_checked_at" TIMESTAMP(3);

CREATE INDEX "orders_warning_level_idx" ON "orders"("warning_level");
