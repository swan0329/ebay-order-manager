-- Persist the real member names selected for unit cards.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "featured_members" TEXT;
