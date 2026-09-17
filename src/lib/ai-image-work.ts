import {
  AI_IMAGE_EXCLUDABLE_STATUSES,
  AI_IMAGE_EXCLUDED_REASON,
  AI_IMAGE_EXCLUDED_STATUS,
  aiProductAllowedSql,
  aiProductQueueableSql,
  aiProductSupplySql,
  aiJobAllowedSql,
  assertAiJobAllowed,
} from "@/lib/ai-image-policy";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { Prisma } from "@/generated/prisma";
import {
  type DewatermarkApiMode,
  getDewatermarkCreditBalance,
  removeWatermarkWithDewatermark,
} from "@/lib/dewatermark-api";
import { listingImageCornerRadius } from "@/lib/listing-image-layout";
import {
  cardLayoutMaskSvg,
  detectCardLayout,
} from "@/lib/photo-card-layout";
import { prisma } from "@/lib/prisma";
import { assertSafeRemoteUrl } from "@/lib/safe-remote-url";
import {
  copyObjectInR2,
  r2KeyFromPublicUrl,
  uploadBufferToR2,
} from "@/lib/r2";

export async function ensureAiImageJobs() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ai_image_jobs" (
    "id" TEXT PRIMARY KEY, "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
    "status" TEXT NOT NULL DEFAULT 'queued', "source_url" TEXT NOT NULL, "preview_url" TEXT,
    "error" TEXT, "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "processed_at" TIMESTAMPTZ,
    "reviewed_at" TIMESTAMPTZ, "reviewed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
    UNIQUE("product_id"))`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ai_image_jobs_status_idx" ON "ai_image_jobs"("status","created_at")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "product_image_history" ("id" TEXT PRIMARY KEY,"product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,"actor_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,"action" TEXT NOT NULL,"image_url" TEXT,"previous_urls" JSONB,"metadata" JSONB,"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  );
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "local_ai_worker_state" (
    "id" INTEGER PRIMARY KEY DEFAULT 1 CHECK ("id"=1),
    "last_heartbeat" TIMESTAMPTZ,
    "requested_remaining" INTEGER NOT NULL DEFAULT 0,
    "completed_total" INTEGER NOT NULL DEFAULT 0,
    "failed_total" INTEGER NOT NULL DEFAULT 0,
    "current_job_id" TEXT,
    "use_local_ai" BOOLEAN NOT NULL DEFAULT FALSE,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "local_ai_worker_state" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "local_ai_worker_state" ADD COLUMN IF NOT EXISTS "use_local_ai" BOOLEAN NOT NULL DEFAULT FALSE`,
  );
}

// 처리 순서는 "처리 예정" 미리보기와 같아야 한다. 한 번에 담긴 작업은 created_at이
// 같으므로 그것만으로는 순서가 고정되지 않는다. 미리보기와 같은 SKU 순서로 맞춘다.
export const nextQueuedJobSql = Prisma.sql`SELECT j."id" FROM "ai_image_jobs" j
    JOIN "products" p ON p."id"=j."product_id"
    WHERE ${aiProductAllowedSql} AND j."status"='queued'
    ORDER BY j."priority" DESC,j."created_at",p."sku"
    FOR UPDATE OF j SKIP LOCKED LIMIT 1`;

export async function createAiJobs(limit: number) {
  await ensureAiImageJobs();
  await reconcileAiImageJobsForSupply();
  // 제외한 상품에는 'excluded' 작업 행이 남아 있으므로 j."id" IS NULL 조건에서 자동으로 빠진다.
  return prisma.$executeRaw`
    INSERT INTO "ai_image_jobs" ("id","product_id","source_url")
    SELECT gen_random_uuid()::text,p."id",p."image_url" FROM "products" p
    LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"
    WHERE j."id" IS NULL AND ${aiProductQueueableSql} AND ${aiProductSupplySql}
    ORDER BY p."sku" LIMIT ${limit}`;
}

export type AiImageWorkPreviewItem = {
  jobId: string | null;
  productId: string;
  sku: string;
  productName: string;
  sourceUrl: string;
  stockQuantity: number;
  supplyCount: number;
  queued: boolean;
};
export type AiImageWorkExcludedItem = AiImageWorkPreviewItem & {
  excludedAt: string | null;
};
type PreviewRow = AiImageWorkPreviewItem & { totalCount: number };
type ExcludedRow = Omit<AiImageWorkExcludedItem, "excludedAt"> & {
  excludedAt: Date | null;
  totalCount: number;
};

function toPreviewItem(row: AiImageWorkPreviewItem): AiImageWorkPreviewItem {
  return {
    jobId: row.jobId,
    productId: row.productId,
    sku: row.sku,
    productName: row.productName,
    sourceUrl: row.sourceUrl,
    stockQuantity: row.stockQuantity,
    supplyCount: row.supplyCount,
    queued: row.queued,
  };
}

// 앞으로 처리할 순서 그대로 보여준다. 이미 대기열에 있는 작업이 먼저 처리되고,
// 그다음에 아직 대기열에 없는 대상이 SKU 순서로 추가된다(createAiJobs와 같은 순서).
export async function listUpcomingAiImageWork({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}) {
  const rows = await prisma.$queryRaw<PreviewRow[]>`
    WITH "candidate" AS (
      SELECT j."id" AS "jobId",p."id" AS "productId",p."sku" AS "sku",
        p."product_name" AS "productName",j."source_url" AS "sourceUrl",
        p."stock_quantity" AS "stockQuantity",
        COALESCE(p."pocamarket_available_count",0) AS "supplyCount",
        TRUE AS "queued",0 AS "tier",j."created_at" AS "queuedAt",j."priority" AS "priority"
      FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
      WHERE j."status"='queued' AND ${aiProductAllowedSql}
      UNION ALL
      SELECT NULL::text,p."id",p."sku",p."product_name",p."image_url",
        p."stock_quantity",COALESCE(p."pocamarket_available_count",0),
        FALSE,1,NULL::timestamptz,0
      FROM "products" p LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"
      WHERE j."id" IS NULL AND ${aiProductQueueableSql} AND ${aiProductSupplySql}
    )
    SELECT "jobId","productId","sku","productName","sourceUrl","stockQuantity",
      "supplyCount","queued",COUNT(*) OVER ()::int AS "totalCount"
    FROM "candidate"
    ORDER BY "priority" DESC,"tier","queuedAt" NULLS LAST,"sku"
    LIMIT ${limit} OFFSET ${offset}`;
  return { items: rows.map(toPreviewItem), total: rows[0]?.totalCount ?? 0 };
}

export async function listExcludedAiImageWork({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}) {
  const rows = await prisma.$queryRaw<ExcludedRow[]>`
    SELECT j."id" AS "jobId",p."id" AS "productId",p."sku" AS "sku",
      p."product_name" AS "productName",
      COALESCE(NULLIF(p."image_url",''),j."source_url") AS "sourceUrl",
      p."stock_quantity" AS "stockQuantity",
      COALESCE(p."pocamarket_available_count",0) AS "supplyCount",
      FALSE AS "queued",j."reviewed_at" AS "excludedAt",
      COUNT(*) OVER ()::int AS "totalCount"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE j."status"=${AI_IMAGE_EXCLUDED_STATUS}
    ORDER BY j."reviewed_at" DESC NULLS LAST,p."sku"
    LIMIT ${limit} OFFSET ${offset}`;
  return {
    items: rows.map((row) => ({
      ...toPreviewItem(row),
      excludedAt: row.excludedAt ? row.excludedAt.toISOString() : null,
    })),
    total: rows[0]?.totalCount ?? 0,
  };
}

// 처리 중이거나 이미 승인된 작업은 제외하지 않는다. 진행 중인 배치 집계를 깨지 않기 위해서다.
export async function excludeAiImageWork(productIds: string[], userId: string) {
  if (!productIds.length)
    return { excluded: 0, skipped: 0, productIds: [] as string[] };
  const rows = await prisma.$queryRaw<Array<{ productId: string }>>`
    WITH "target" AS (
      SELECT p."id" AS "productId",
        COALESCE(NULLIF(p."image_url",''),j."source_url") AS "sourceUrl"
      FROM "products" p LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"
      WHERE p."id" IN (${Prisma.join(productIds)}) AND ${aiProductAllowedSql}
    )
    INSERT INTO "ai_image_jobs"
      ("id","product_id","status","source_url","error","reviewed_at","reviewed_by")
    SELECT gen_random_uuid()::text,t."productId",${AI_IMAGE_EXCLUDED_STATUS},
      t."sourceUrl",${AI_IMAGE_EXCLUDED_REASON},NOW(),${userId}
    FROM "target" t WHERE t."sourceUrl" IS NOT NULL AND t."sourceUrl"<>''
    ON CONFLICT ("product_id") DO UPDATE
      SET "status"=${AI_IMAGE_EXCLUDED_STATUS},"error"=EXCLUDED."error",
        "preview_url"=NULL,"reviewed_at"=NOW(),"reviewed_by"=EXCLUDED."reviewed_by"
      WHERE "ai_image_jobs"."status" IN (${Prisma.join([
        ...AI_IMAGE_EXCLUDABLE_STATUSES,
      ])})
    RETURNING "product_id" AS "productId"`;
  return {
    excluded: rows.length,
    skipped: productIds.length - rows.length,
    productIds: rows.map((row) => row.productId),
  };
}

export async function restoreExcludedAiImageWork(productIds: string[]) {
  if (!productIds.length) return { restored: 0, productIds: [] as string[] };
  const rows = await prisma.$queryRaw<Array<{ productId: string }>>`
    UPDATE "ai_image_jobs"
    SET "status"='queued',"error"=NULL,"preview_url"=NULL,"processed_at"=NULL,
      "reviewed_at"=NULL,"reviewed_by"=NULL,"api_batch_id"=NULL
    WHERE "status"=${AI_IMAGE_EXCLUDED_STATUS}
      AND "product_id" IN (${Prisma.join(productIds)})
    RETURNING "product_id" AS "productId"`;
  const restored = rows.map((row) => row.productId);
  // 공급이 없는 상품은 기존 규칙대로 곧바로 대기 상태로 내린다.
  if (restored.length) await reconcileAiImageJobsForSupply(restored);
  return { restored: restored.length, productIds: restored };
}

export async function reconcileAiImageJobsForSupply(productIds?: string[]) {
  const productFilter = productIds?.length
    ? Prisma.sql`AND p."id" IN (${Prisma.join(productIds)})`
    : Prisma.empty;
  const [deferred, restored] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "ai_image_jobs" j
      SET "status"='waiting_supply',"error"='포카마켓 조달 불가로 자동 대기'
      FROM "products" p
      WHERE p."id"=j."product_id"
        AND j."status"='queued'
        AND p."stock_quantity"<=0
        AND COALESCE(p."pocamarket_available_count",0)<=0
        ${productFilter}`,
    prisma.$executeRaw`
      UPDATE "ai_image_jobs" j
      SET "status"='queued',"error"=NULL
      FROM "products" p
      WHERE p."id"=j."product_id"
        AND j."status"='waiting_supply'
        AND (
          p."stock_quantity">0
          OR COALESCE(p."pocamarket_available_count",0)>0
        )
        ${productFilter}`,
  ]);
  return { deferred, restored };
}

const CARD_WIDTH = 540;
const CARD_HEIGHT = 860;
// 업로드 단계(createPreparedListingImage)가 같은 카드를 다시 라운드 처리한다. 두 반경이
// 다르면 검수에서 본 모서리와 실제 등록 이미지의 모서리가 어긋나므로 공용 공식을 쓴다.
const CARD_CORNER_RADIUS = listingImageCornerRadius(CARD_WIDTH, CARD_HEIGHT);
const CARD_CORNER_RADIUS_RATIO = 0.045;

// 카드 배치를 보고 마스크를 정한다. 한 장이면 지금까지처럼 바깥 테두리를, 대각선
// 두 장이면 카드마다 따로 둥글게 만든다. 경계를 확신할 수 없으면 아무것도 깎지 않는다.
async function cardCornerMask(sized: Buffer) {
  const { data, info } = await sharp(sized)
    .resize(120, 191, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const layout = detectCardLayout({ width: info.width, height: info.height, data });
  const svg = cardLayoutMaskSvg(
    layout,
    CARD_WIDTH,
    CARD_HEIGHT,
    CARD_CORNER_RADIUS_RATIO,
    CARD_CORNER_RADIUS,
  );
  return { layout, mask: svg ? Buffer.from(svg) : null };
}

// sharp는 한 파이프라인 안에서 flatten을 composite보다 먼저 적용한다. 둥근 모서리를
// 같은 파이프라인에서 흰 배경과 함께 처리하면 잘려나간 모서리는 알파만 0이 되고,
// JPEG에는 알파가 없으므로 그 자리가 검은색으로 남는다. 라운드 결과를 PNG로 확정한
// 뒤 두 번째 파이프라인에서 흰 배경을 깔아야 모서리가 흰색이 된다.
async function toRoundedCardJpeg(image: sharp.Sharp) {
  const sized = await image
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const { mask } = await cardCornerMask(sized);
  const rounded = mask
    ? await sharp(sized)
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer()
    : sized;
  return sharp(rounded)
    .flatten({ background: "white" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function downloadImage(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`원본 이미지 HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 15_000_000)
    throw new Error("원본 이미지가 15MB를 초과합니다.");
  return data;
}

async function makePreview(sourceUrl: string) {
  const input = await downloadImage(sourceUrl);
  const maskPath = path.join(
    process.cwd(),
    "public",
    "pocamarket-watermark-mask-v4.png",
  );
  const decoded = await sharp(input)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = decoded.data;
  const meta = decoded.info;
  const mask = await sharp(maskPath)
    .resize(meta.width, meta.height, { fit: "fill" })
    .raw()
    .toBuffer();
  for (let p = 0; p < meta.width * meta.height; p++) {
    // The V4 matte already contains the calibrated alpha. Applying an extra
    // multiplier produces the dark watermark-shaped lines seen in review.
    const alpha = Math.min(0.44, mask[p] / 255);
    if (alpha < 0.003) continue;
    const o = p * 4;
    for (let c = 0; c < 3; c++)
      raw[o + c] = Math.max(
        0,
        Math.min(255, Math.round((raw[o + c] - 255 * alpha) / (1 - alpha))),
      );
  }
  return toRoundedCardJpeg(
    sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }),
  );
}

export async function processNextAiJob() {
  await ensureAiImageJobs();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; productId: string; sourceUrl: string }>
  >`
    UPDATE "ai_image_jobs" SET "status"='processing',"error"=NULL
    WHERE "id"=(${nextQueuedJobSql})
    RETURNING "id","product_id" AS "productId","source_url" AS "sourceUrl"`;
  const claimed = rows[0];
  if (!claimed) return null;
  const product = await prisma.product.findUnique({
    where: { id: claimed.productId },
    select: { sku: true },
  });
  const job = { ...claimed, sku: product?.sku ?? claimed.productId };
  try {
    const buffer = await makePreview(job.sourceUrl);
    const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
    const uploaded = await uploadBufferToR2({
      buffer,
      key: `ai-image-reviews/${safeProductNumber}/${Date.now()}.jpg`,
      contentType: "image/jpeg",
      cacheControl: "no-cache",
    });
    await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='review',"preview_url"=${uploaded.url},"processed_at"=NOW() WHERE "id"=${job.id}`;
    return { id: job.id, status: "review" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "자동 처리 실패";
    await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='failed',"error"=${message},"processed_at"=NOW() WHERE "id"=${job.id}`;
    return { id: job.id, status: "failed" };
  }
}

export async function claimNextAiJob() {
  await ensureAiImageJobs();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; productId: string; sourceUrl: string }>
  >`
    UPDATE "ai_image_jobs" SET "status"='processing',"error"=NULL
    WHERE "id"=(${nextQueuedJobSql})
    RETURNING "id","product_id" AS "productId","source_url" AS "sourceUrl"`;
  return rows[0] ?? null;
}

/** 지금 돌고 있는 자동 처리 작업. 있으면 새 작업을 만들지 않는다. */
export async function runningAiImageApiBatch() {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ai_image_api_batches"
    WHERE "status" IN ('queued','running') ORDER BY "created_at" LIMIT 1`;
  return rows[0]?.id ?? null;
}

export async function createAiImageApiBatch(
  userId: string,
  requestedCount: number,
  mode: DewatermarkApiMode,
) {
  await ensureAiImageJobs();
  if (await runningAiImageApiBatch())
    throw new Error("이미 진행 중인 AI 이미지 자동 처리 작업이 있습니다.");
  // The automatic action should be self-contained. Queue eligible products
  // here instead of requiring the separate "add unprocessed" button first.
  await createAiJobs(requestedCount);
  const counts = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS "count" FROM "ai_image_jobs" WHERE ${aiJobAllowedSql} AND "status"='queued'`;
  const accepted = Math.min(requestedCount, Number(counts[0]?.count ?? 0));
  if (!accepted) throw new Error("처리 대기 중인 이미지가 없습니다.");
  const availableCredits = await getDewatermarkCreditBalance();
  const requiredCredits = accepted * (mode === "PRO" ? 3 : 1);
  if (availableCredits < requiredCredits) {
    throw new Error(
      `크레딧이 ${requiredCredits - availableCredits}개 부족합니다. ` +
        `현재 ${availableCredits}개, 이번 작업에는 ${requiredCredits}개가 필요합니다.`,
    );
  }
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "ai_image_api_batches"
      ("id","user_id","status","mode","requested_count")
    VALUES (${id},${userId},'queued',${mode},${accepted})`;
  return { id, accepted, mode, availableCredits, requiredCredits };
}

async function claimAiImageApiBatchJob(batchId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; mode: DewatermarkApiMode }>
  >`
    WITH candidate AS (
      ${nextQueuedJobSql}
    ), permit AS (
      UPDATE "ai_image_api_batches"
      SET "claimed_count"="claimed_count"+1,
          "status"='running',
          "updated_at"=NOW()
      WHERE "id"=${batchId}
        AND "status" IN ('queued','running')
        AND "claimed_count"<"requested_count"
        AND EXISTS (SELECT 1 FROM candidate)
      RETURNING "mode"
    )
    UPDATE "ai_image_jobs"
    SET "status"='processing',"error"=NULL,"api_batch_id"=${batchId}
    WHERE "id"=(SELECT "id" FROM candidate)
      AND EXISTS (SELECT 1 FROM permit)
    RETURNING "id",(SELECT "mode" FROM permit) AS "mode"`;
  return rows[0] ?? null;
}

async function processAiImageApiBatchJob(batchId: string) {
  const claimed = await claimAiImageApiBatchJob(batchId);
  if (!claimed) return false;
  try {
    await completeAiJobWithDewatermark(claimed.id, claimed.mode);
    await prisma.$executeRaw`
      UPDATE "ai_image_api_batches"
      SET "completed_count"="completed_count"+1,"updated_at"=NOW()
      WHERE "id"=${batchId}`;
  } catch (error) {
    const message = (error instanceof Error ? error.message : "API 처리 실패").slice(0, 500);
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE "ai_image_jobs"
        SET "status"='failed',"error"=${message},"processed_at"=NOW()
        WHERE "id"=${claimed.id} AND "status"='processing'`,
      prisma.$executeRaw`
        UPDATE "ai_image_api_batches"
        SET "failed_count"="failed_count"+1,
            "error_message"=${message},
            "updated_at"=NOW()
        WHERE "id"=${batchId}`,
    ]);
  }
  return true;
}

export async function processAiImageApiBatch(batchId: string) {
  const recovered = await prisma.$queryRaw<Array<{ count: bigint }>>`
    WITH recovered_jobs AS (
      UPDATE "ai_image_jobs"
      SET "status"='queued',"error"='Interrupted server task recovered automatically',
          "api_batch_id"=NULL
      WHERE "api_batch_id"=${batchId}
        AND "status"='processing'
        AND "processed_at" IS NULL
        AND "created_at"<NOW()-INTERVAL '5 minutes'
      RETURNING 1
    ), recovered_count AS (
      SELECT COUNT(*)::bigint AS "count" FROM recovered_jobs
    )
    UPDATE "ai_image_api_batches"
    SET "claimed_count"=GREATEST(0,"claimed_count"-(SELECT "count" FROM recovered_count)::integer),
        "updated_at"=NOW()
    WHERE "id"=${batchId} AND (SELECT "count" FROM recovered_count)>0
    RETURNING (SELECT "count" FROM recovered_count) AS "count"`;
  const configuredConcurrency = Number(
    process.env.AI_IMAGE_API_CONCURRENCY ?? "4",
  );
  const concurrency = Number.isFinite(configuredConcurrency)
    ? Math.max(1, Math.min(12, Math.trunc(configuredConcurrency)))
    : 4;
  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      processAiImageApiBatchJob(batchId),
    ),
  );
  const batch = (
    await prisma.$queryRaw<
      Array<{
        requestedCount: number;
        claimedCount: number;
        completedCount: number;
        failedCount: number;
        status: string;
      }>
    >`
      SELECT "requested_count" AS "requestedCount",
        "claimed_count" AS "claimedCount",
        "completed_count" AS "completedCount",
        "failed_count" AS "failedCount","status"
      FROM "ai_image_api_batches" WHERE "id"=${batchId} LIMIT 1`
  )[0];
  if (!batch) throw new Error("AI 이미지 자동 처리 작업을 찾을 수 없습니다.");
  const noMoreClaims = !results.some(Boolean);
  const finishedClaims = batch.claimedCount >= batch.requestedCount;
  const settled = batch.completedCount + batch.failedCount >= batch.claimedCount;
  const completed = settled && (finishedClaims || noMoreClaims);
  if (completed) {
    await prisma.$executeRaw`
      UPDATE "ai_image_api_batches"
      SET "status"='completed',"completed_at"=NOW(),"updated_at"=NOW()
      WHERE "id"=${batchId} AND "status" IN ('queued','running')`;
  }
  return {
    processed: results.filter(Boolean).length,
    recovered: Number(recovered[0]?.count ?? 0),
    shouldContinue: !completed,
    completedCount: batch.completedCount,
    failedCount: batch.failedCount,
  };
}

export async function completeAiJob(id: string, dataUrl: string) {
  await assertAiJobAllowed(id);
  const rows = await prisma.$queryRaw<
    Array<{ sku: string }>
  >`SELECT p."sku" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."id"=${id} AND j."status"='processing' LIMIT 1`;
  if (!rows[0]) throw new Error("진행 중인 AI 작업을 찾을 수 없습니다.");
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const normalized = await toRoundedCardJpeg(sharp(input).rotate());
  const safeProductNumber = rows[0].sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploaded = await uploadBufferToR2({
    buffer: normalized,
    key: `ai-image-reviews/${safeProductNumber}/${Date.now()}.jpg`,
    contentType: "image/jpeg",
    cacheControl: "no-cache",
  });
  await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='review',"preview_url"=${uploaded.url},"processed_at"=NOW() WHERE "id"=${id}`;
  return uploaded.url;
}

export async function completeAiJobWithDewatermark(
  id: string,
  mode: DewatermarkApiMode,
) {
  await assertAiJobAllowed(id);
  const rows = await prisma.$queryRaw<
    Array<{ sourceUrl: string; sku: string }>
  >`SELECT j."source_url" AS "sourceUrl",p."sku"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE j."id"=${id} AND j."status"='processing' LIMIT 1`;
  const job = rows[0];
  if (!job) throw new Error("진행 중인 AI 이미지 작업을 찾을 수 없습니다.");

  const source = await downloadImage(job.sourceUrl);
  const removed = await removeWatermarkWithDewatermark(source, mode);
  const normalized = await toRoundedCardJpeg(sharp(removed.buffer).rotate());
  const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploaded = await uploadBufferToR2({
    buffer: normalized,
    key: `ai-image-reviews/${safeProductNumber}/${Date.now()}-dewatermark.jpg`,
    contentType: "image/jpeg",
    cacheControl: "no-cache",
  });
  await prisma.$executeRaw`UPDATE "ai_image_jobs"
    SET "status"='review',"preview_url"=${uploaded.url},"processed_at"=NOW(),
        "error"=${`Dewatermark ${removed.mode}`}
    WHERE "id"=${id}`;
  return uploaded.url;
}

export async function completeAiJobWithSafeFallback(id: string) {
  await assertAiJobAllowed(id);
  const rows = await prisma.$queryRaw<
    Array<{ sourceUrl: string; sku: string }>
  >`SELECT j."source_url" AS "sourceUrl",p."sku"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE j."id"=${id} AND j."status"='processing' LIMIT 1`;
  const job = rows[0];
  if (!job) throw new Error("진행 중인 AI 작업을 찾을 수 없습니다.");
  const buffer = await makePreview(job.sourceUrl);
  const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploaded = await uploadBufferToR2({
    buffer,
    key: `ai-image-reviews/${safeProductNumber}/${Date.now()}-safe.jpg`,
    contentType: "image/jpeg",
    cacheControl: "no-cache",
  });
  await prisma.$executeRaw`UPDATE "ai_image_jobs"
    SET "status"='review',"preview_url"=${uploaded.url},"processed_at"=NOW(),
        "error"='AI dark-artifact gate: OpenCV fallback used'
    WHERE "id"=${id}`;
  return uploaded.url;
}

async function hasBlackCorner(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return data[offset] + data[offset + 1] + data[offset + 2];
  };
  return [
    sum(0, 0),
    sum(info.width - 1, 0),
    sum(0, info.height - 1),
    sum(info.width - 1, info.height - 1),
  ].some((value) => value < 120);
}

// 이미 만들어진 검수 이미지의 검은 모서리를 Dewatermark 크레딧 없이 흰색으로 되돌린다.
// 같은 라운드 마스크를 다시 씌우는 것뿐이라 카드 그림 자체는 바뀌지 않는다.
export async function repairAiPreviewCorners({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}) {
  const jobs = await prisma.$queryRaw<
    Array<{ id: string; sku: string; previewUrl: string }>
  >`
    SELECT j."id",p."sku",j."preview_url" AS "previewUrl"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE ${aiJobAllowedSql} AND j."status" IN ('review','held','pass_ready','rework')
      AND COALESCE(j."preview_url",'')<>''
    ORDER BY j."created_at",j."id"
    LIMIT ${limit} OFFSET ${offset}`;
  let repaired = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const current = await downloadImage(job.previewUrl);
      // 두 장짜리 배치는 예전 기준으로는 배경과 카드를 가리지 못해 아예 깎지
      // 않았다. 검은 모서리가 없어도 두 장으로 읽히면 다시 깎는다. 이미 제대로
      // 깎인 그림을 다시 깎아도 결과는 같다.
      const { layout } = await cardCornerMask(
        await sharp(current).resize(CARD_WIDTH, CARD_HEIGHT, { fit: "fill" }).png().toBuffer(),
      );
      if (layout.kind !== "cards" && !(await hasBlackCorner(current))) {
        skipped += 1;
        continue;
      }
      const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
      const uploaded = await uploadBufferToR2({
        buffer: await toRoundedCardJpeg(sharp(current)),
        key: `ai-image-reviews/${safeProductNumber}/${Date.now()}-corner.jpg`,
        contentType: "image/jpeg",
        cacheControl: "no-cache",
      });
      // 검수 순서를 흔들지 않도록 created_at과 상태는 그대로 둔다.
      await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "preview_url"=${uploaded.url}
        WHERE "id"=${job.id} AND "status" IN ('review','held','pass_ready','rework')`;
      repaired += 1;
    } catch (error) {
      failed += 1;
      console.error("AI 검수 이미지 모서리 보정 실패", job.sku, error);
    }
  }
  return { scanned: jobs.length, repaired, skipped, failed };
}

/**
 * 구글렌즈로 찾은 이미지를 이 작업의 검수 결과로 저장한다. 사람이 고른 주소를
 * 서버가 내려받아 같은 규격(540×860·카드별 라운드·흰 배경)으로 맞춘 뒤 검수 대기에
 * 올린다. 최종 상품 이미지 확정은 지금처럼 통과를 눌러야 이뤄진다.
 */
export async function saveLensCandidateForAiJob(
  id: string,
  input: { image?: string; imageUrl?: string },
) {
  await assertAiJobAllowed(id);
  const rows = await prisma.$queryRaw<
    Array<{ sku: string; status: string; previewUrl: string | null; backupUrl: string | null }>
  >`
    SELECT p."sku", j."status", j."preview_url" AS "previewUrl",
      j."backup_preview_url" AS "backupUrl"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE j."id"=${id} LIMIT 1`;
  const job = rows[0];
  if (!job) throw new Error("AI 이미지 작업을 찾을 수 없습니다.");
  if (job.status === "approved")
    throw new Error("이미 상품 이미지로 확정한 작업입니다. 다시 처리하려면 재처리해 주세요.");
  const source = input.image
    ? Buffer.from(input.image.slice(input.image.indexOf(",") + 1), "base64")
    : await downloadImage((await assertSafeRemoteUrl(input.imageUrl ?? "")).toString());
  const normalized = await toRoundedCardJpeg(sharp(source).rotate());
  const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploaded = await uploadBufferToR2({
    buffer: normalized,
    key: `ai-image-reviews/${safeProductNumber}/${Date.now()}-lens.jpg`,
    contentType: "image/jpeg",
    cacheControl: "no-cache",
  });
  // AI가 만든 직전 결과는 한 번만 보관한다. 렌즈 결과를 연달아 바꿔도 되돌릴
  // 대상은 언제나 사람이 손대기 전의 AI 결과다.
  const backup = job.backupUrl ?? job.previewUrl;
  const updated = await prisma.$executeRaw`UPDATE "ai_image_jobs"
    SET "status"='review',"preview_url"=${uploaded.url},"processed_at"=NOW(),
      "backup_preview_url"=${backup},
      "error"='구글렌즈에서 고른 이미지',"reviewed_at"=NULL,"reviewed_by"=NULL
    WHERE "id"=${id} AND "status"<>'approved'`;
  if (!updated) throw new Error("작업 상태가 바뀌어 저장하지 못했습니다. 화면을 새로고침해 주세요.");
  return { url: uploaded.url, sku: job.sku, canRestore: Boolean(backup) };
}

/** 구글렌즈 결과가 마음에 들지 않을 때 AI가 만든 직전 결과로 되돌린다. */
export async function restoreAiPreviewForJob(id: string) {
  await assertAiJobAllowed(id);
  const rows = await prisma.$queryRaw<Array<{ sku: string; backupUrl: string | null }>>`
    SELECT p."sku", j."backup_preview_url" AS "backupUrl"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE j."id"=${id} AND j."status"<>'approved' LIMIT 1`;
  const job = rows[0];
  if (!job?.backupUrl) throw new Error("되돌릴 AI 결과가 없습니다.");
  await prisma.$executeRaw`UPDATE "ai_image_jobs"
    SET "status"='review',"preview_url"=${job.backupUrl},"backup_preview_url"=NULL,
      "processed_at"=NOW(),"error"='AI 결과로 되돌림',"reviewed_at"=NULL,"reviewed_by"=NULL
    WHERE "id"=${id} AND "status"<>'approved'`;
  return { url: job.backupUrl, sku: job.sku };
}

/** 사람이 고른 상품을 대기열 맨 앞으로 올린다. 없는 작업은 새로 담는다. */
export async function prioritizeAiImageWork(productIds: string[]) {
  if (!productIds.length) return { prioritized: 0, productIds: [] as string[] };
  const rows = await prisma.$queryRaw<Array<{ productId: string }>>`
    WITH "target" AS (
      SELECT p."id" AS "productId",
        COALESCE(NULLIF(p."image_url",''),j."source_url") AS "sourceUrl"
      FROM "products" p LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"
      WHERE p."id" IN (${Prisma.join(productIds)}) AND ${aiProductAllowedSql}
    )
    INSERT INTO "ai_image_jobs" ("id","product_id","status","source_url","priority")
    SELECT gen_random_uuid()::text,t."productId",'queued',t."sourceUrl",1
    FROM "target" t WHERE t."sourceUrl" IS NOT NULL AND t."sourceUrl"<>''
    ON CONFLICT ("product_id") DO UPDATE
      SET "priority"=1,
        "status"=CASE WHEN "ai_image_jobs"."status"='excluded' THEN 'queued'
          ELSE "ai_image_jobs"."status" END,
        "error"=CASE WHEN "ai_image_jobs"."status"='excluded' THEN NULL
          ELSE "ai_image_jobs"."error" END
      WHERE "ai_image_jobs"."status" IN ('queued','waiting_supply','excluded')
    RETURNING "product_id" AS "productId"`;
  const prioritized = rows.map((row) => row.productId);
  if (prioritized.length) await reconcileAiImageJobsForSupply(prioritized);
  return { prioritized: prioritized.length, productIds: prioritized };
}

export async function approveAiJob(id: string, userId: string) {
  await assertAiJobAllowed(id);
  const rows = await prisma.$queryRaw<
    Array<{
      productId: string;
      previewUrl: string;
      sku: string;
      urls: string[];
    }>
  >`
    SELECT j."product_id" AS "productId",j."preview_url" AS "previewUrl",p."sku",p."ebay_image_urls" AS "urls"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."id"=${id} AND j."status"='pass_ready' LIMIT 1`;
  const job = rows[0];
  if (!job?.previewUrl) {
    // 통과와 동시에 올라간 작업을 열려 있던 화면에서 다시 눌러도 오류로 만들지
    // 않는다. 이미 확정된 같은 이미지를 그대로 돌려준다.
    const settled = await prisma.$queryRaw<Array<{ imageUrl: string | null }>>`
      SELECT p."image_url" AS "imageUrl" FROM "ai_image_jobs" j
      JOIN "products" p ON p."id"=j."product_id"
      WHERE j."id"=${id} AND j."status"='approved' LIMIT 1`;
    if (settled[0]?.imageUrl) return settled[0].imageUrl;
    throw new Error("검수할 AI 결과가 없습니다.");
  }
  const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = `products/${safeProductNumber}/${safeProductNumber}.jpg`;
  // 검수 이미지는 이미 같은 버킷에 있다. 내려받아 다시 올리지 않고 그대로 복사한다.
  // 자동 처리로 붐빌 때 한 장에 5~13초씩 걸리던 구간이다.
  const previewKey = r2KeyFromPublicUrl(job.previewUrl.split("?")[0]);
  const uploaded = previewKey
    ? await copyObjectInR2({
        fromKey: previewKey,
        toKey: key,
        contentType: "image/jpeg",
        cacheControl: "no-cache",
      })
    : await uploadBufferToR2({
        buffer: await downloadImage(job.previewUrl),
        key,
        contentType: "image/jpeg",
        cacheControl: "no-cache",
      });
  await prisma.$transaction([
    prisma.product.update({
      where: { id: job.productId },
      data: {
        imageUrl: uploaded.url,
        // Only the explicitly approved AI result is channel-ready. job.urls
        // contains source/history candidates, not separately approved images.
        ebayImageUrls: [uploaded.url],
      },
    }),
    prisma.$executeRaw`UPDATE "products" SET "image_source"='lens_workbench' WHERE "id"=${job.productId}`,
    prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='approved',"reviewed_at"=NOW(),"reviewed_by"=${userId} WHERE "id"=${id}`,
    prisma.$executeRaw`INSERT INTO "product_image_history" ("id","product_id","actor_id","action","image_url","previous_urls","metadata") VALUES (${randomUUID()},${job.productId},${userId},'ai_approved',${uploaded.url},${JSON.stringify(job.urls ?? [])}::jsonb,${JSON.stringify({ jobId: id, sourceUrl: job.previewUrl })}::jsonb)`,
  ]);
  return uploaded.url;
}
