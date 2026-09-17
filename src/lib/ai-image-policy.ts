import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

// Group metadata is authoritative; never infer the group from a member name.
export const aiProductAllowedSql = Prisma.sql`UPPER(TRIM(COALESCE("brand", ''))) NOT IN ('BTS','방탄소년단','방탄','BANGTAN BOYS','BANGTAN SONYEONDAN')`;
export const aiJobAllowedSql = Prisma.sql`"product_id" IN (SELECT "id" FROM "products" WHERE ${aiProductAllowedSql})`;

// 사람이 AI 작업에서 뺀 상품. 작업 이력을 남기려고 행을 지우지 않고 상태로 보존한다.
export const AI_IMAGE_EXCLUDED_STATUS = "excluded";
export const AI_IMAGE_EXCLUDED_REASON = "관리자가 AI 이미지 작업에서 제외";
// 제외를 되돌릴 수 있는 상태. 처리 중·승인 완료 작업은 건드리지 않는다.
export const AI_IMAGE_EXCLUDABLE_STATUSES = [
  "queued",
  "waiting_supply",
  "rework",
  "failed",
  AI_IMAGE_EXCLUDED_STATUS,
] as const;

// 아래 조건은 상품을 별칭 p로 조회하는 질의에서만 사용한다.
// 처리 예정 미리보기와 실제 큐 투입이 같은 조건을 써야 화면과 작업이 어긋나지 않는다.
export const aiProductQueueableSql = Prisma.sql`${aiProductAllowedSql}
  AND p."image_url" IS NOT NULL AND p."image_url"<>''
  AND (p."user_front_image_url" IS NULL OR p."user_front_image_url"='')
  AND COALESCE(p."image_source",'pocamarket') NOT IN ('r2_user_uploaded','lens_workbench')
  AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p."ebay_image_urls",ARRAY[]::TEXT[])) u WHERE u LIKE '%/products/%/lens-card-%')`;
export const aiProductSupplySql = Prisma.sql`(p."stock_quantity">0 OR COALESCE(p."pocamarket_available_count",0)>0)`;
// "이미지 작업 필요" 건수에서 빼는 상태. 사람이 작업에서 제외했거나, 이미 통과시켜
// 최종 업로드만 남은 상품은 사람이 더 할 일이 없다. 업로드 전까지 상품 이미지는
// 원본 그대로이므로 판매가능 판정(imageReadySql)은 지금처럼 실제 적용된 이미지를
// 기준으로 두고, 작업 대기량을 세는 곳에서만 이 조건을 쓴다.
export const AI_IMAGE_WORK_SETTLED_STATUSES = [
  AI_IMAGE_EXCLUDED_STATUS,
  "pass_ready",
] as const;
export const aiProductWorkPending = (productIdColumn: Prisma.Sql) =>
  Prisma.sql`NOT EXISTS (SELECT 1 FROM "ai_image_jobs" settled_job WHERE settled_job."product_id"=${productIdColumn} AND settled_job."status" IN (${Prisma.join([
    ...AI_IMAGE_WORK_SETTLED_STATUSES,
  ])}))`;
export const aiProductWorkPendingSql = aiProductWorkPending(
  Prisma.raw('p."id"'),
);

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
