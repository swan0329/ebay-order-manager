import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

// Group metadata is authoritative; never infer the group from a member name.
export const aiProductAllowedSql = Prisma.sql`UPPER(TRIM(COALESCE("brand", ''))) NOT IN ('BTS','방탄소년단','방탄','BANGTAN BOYS','BANGTAN SONYEONDAN')`;
export const aiJobAllowedSql = Prisma.sql`"product_id" IN (SELECT "id" FROM "products" WHERE ${aiProductAllowedSql})`;

export async function assertAiJobAllowed(id: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ai_image_jobs" WHERE "id"=${id} AND ${aiJobAllowedSql}`;
  if (!rows[0]) throw new Error("BTS는 수동 이미지 작업만 가능합니다. AI 작업 대상이 아닙니다.");
}

export async function excludeManualAiJobs() {
  // Keep images and history. In-flight batches settle through their existing completion/recovery path.
  const rows = await prisma.$queryRaw<Array<{ sku: string; previousStatus: string }>>`
    WITH excluded AS (
      SELECT j."id",p."sku",j."status" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
      WHERE NOT (${aiProductAllowedSql}) AND j."status" NOT IN ('approved','manual_only','processing')
    ), changed AS (
      UPDATE "ai_image_jobs" j SET "status"='manual_only',"error"='BTS 수동 이미지 작업 전용'
      FROM excluded e WHERE j."id"=e."id" RETURNING e."sku",e."status" AS "previousStatus"
    ) SELECT * FROM changed`;
  const processing = await prisma.$queryRaw<Array<{ sku: string }>>`SELECT p."sku" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE NOT (${aiProductAllowedSql}) AND j."status"='processing'`;
  return { excluded: rows.length, items: rows, processing };
}
