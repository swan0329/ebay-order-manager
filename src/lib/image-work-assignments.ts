import { prisma } from "@/lib/prisma";

export type ImageWorkAssignment = {
  id: string;
  productId: string;
  workerId: string;
  status: string;
  assignedAt: Date;
  submittedAt: Date | null;
};

export async function ensureImageWorkAssignments() {
  // Production deploys do not run `prisma db push` because this database also
  // contains legacy columns outside Prisma. Apply only this additive change.
  await prisma.$executeRawUnsafe(`ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'WORKER'`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "image_work_assignments" (
      "id" TEXT PRIMARY KEY,
      "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "worker_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "status" TEXT NOT NULL DEFAULT 'assigned',
      "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "submitted_at" TIMESTAMPTZ,
      UNIQUE ("product_id")
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "image_work_assignments_worker_status_idx" ON "image_work_assignments" ("worker_id", "status")`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "rejection_code" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "result_url" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_work_assignments" ADD COLUMN IF NOT EXISTS "result_key" TEXT`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "product_image_history" (
      "id" TEXT PRIMARY KEY,
      "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "actor_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
      "action" TEXT NOT NULL,
      "image_url" TEXT,
      "previous_urls" JSONB,
      "metadata" JSONB,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "product_image_history_product_idx" ON "product_image_history" ("product_id", "created_at" DESC)`);
}

export async function workerCanAccessProduct(workerId: string, productId: string) {
  await ensureImageWorkAssignments();
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT TRUE AS "ok" FROM "image_work_assignments"
    WHERE "worker_id" = ${workerId} AND "product_id" = ${productId} AND "status" IN ('assigned', 'in_progress', 'rejected')
    LIMIT 1
  `;
  return Boolean(rows[0]?.ok);
}
