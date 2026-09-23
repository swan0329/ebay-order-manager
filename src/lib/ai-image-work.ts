import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { Prisma } from "@/generated/prisma";
import {
  type DewatermarkApiMode,
  getDewatermarkCreditBalance,
  removeWatermarkWithDewatermark,
} from "@/lib/dewatermark-api";
import { prisma } from "@/lib/prisma";
import { getImageWorkbenchSettings, type ImageWorkbenchSettings } from "@/lib/image-workbench-settings";
import { deleteObjectFromR2, r2KeyFromPublicUrl, uploadBufferToR2 } from "@/lib/r2";

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

export async function createAiJobs(limit: number) {
  await ensureAiImageJobs();
  await reconcileAiImageJobsForSupply();
  return prisma.$executeRaw`
    INSERT INTO "ai_image_jobs" ("id","product_id","source_url")
    SELECT gen_random_uuid()::text,p."id",p."image_url" FROM "products" p
    LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"
    WHERE j."id" IS NULL AND p."image_url" IS NOT NULL AND p."image_url"<>''
      AND (p."user_front_image_url" IS NULL OR p."user_front_image_url"='')
      AND (
        p."stock_quantity">0
        OR COALESCE(p."pocamarket_available_count",0)>0
      )
      AND COALESCE(p."image_source",'pocamarket') NOT IN ('r2_user_uploaded','lens_workbench')
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p."ebay_image_urls",ARRAY[]::TEXT[])) u WHERE u LIKE '%/products/%/lens-card-%')
    ORDER BY p."sku" LIMIT ${limit}`;
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
  const card = await sharp(raw, {
    raw: { width: meta.width, height: meta.height, channels: 4 },
  })
    .resize(540, 860, { fit: "fill" })
    .composite([
      {
        input: Buffer.from(
          `<svg width="540" height="860"><rect width="540" height="860" rx="25" fill="white"/></svg>`,
        ),
        blend: "dest-in",
      },
    ])
    .flatten({ background: "white" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return card;
}

export async function processNextAiJob() {
  await ensureAiImageJobs();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; productId: string; sourceUrl: string }>
  >`
    UPDATE "ai_image_jobs" SET "status"='processing',"error"=NULL
    WHERE "id"=(SELECT "id" FROM "ai_image_jobs" WHERE "status"='queued' ORDER BY "created_at" FOR UPDATE SKIP LOCKED LIMIT 1)
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
    WHERE "id"=(SELECT "id" FROM "ai_image_jobs" WHERE "status"='queued' ORDER BY "created_at" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING "id","product_id" AS "productId","source_url" AS "sourceUrl"`;
  return rows[0] ?? null;
}

export async function createAiImageApiBatch(
  userId: string,
  requestedCount: number,
  mode: DewatermarkApiMode,
) {
  await ensureAiImageJobs();
  const active = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ai_image_api_batches"
    WHERE "status" IN ('queued','running')
    ORDER BY "created_at" LIMIT 1`;
  if (active[0]) throw new Error("이미 진행 중인 AI 이미지 자동 처리 작업이 있습니다.");
  // The automatic action should be self-contained. Queue eligible products
  // here instead of requiring the separate "add unprocessed" button first.
  await createAiJobs(requestedCount);
  const counts = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS "count" FROM "ai_image_jobs" WHERE "status"='queued'`;
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
      SELECT "id" FROM "ai_image_jobs"
      WHERE "status"='queued'
      ORDER BY "created_at"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
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
    const owners = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT "user_id" AS "userId" FROM "ai_image_api_batches" WHERE "id"=${batchId} LIMIT 1`;
    await completeAiJobWithDewatermark(claimed.id, claimed.mode, owners[0] ? await getImageWorkbenchSettings(owners[0].userId) : undefined);
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
  const rows = await prisma.$queryRaw<
    Array<{ sku: string }>
  >`SELECT p."sku" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."id"=${id} AND j."status"='processing' LIMIT 1`;
  if (!rows[0]) throw new Error("진행 중인 AI 작업을 찾을 수 없습니다.");
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const normalized = await sharp(input)
    .rotate()
    .resize(540, 860, { fit: "fill" })
    .composite([
      {
        input: Buffer.from(
          `<svg width="540" height="860"><rect width="540" height="860" rx="25" fill="white"/></svg>`,
        ),
        blend: "dest-in",
      },
    ])
    .flatten({ background: "white" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
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
  enhancementSettings?: ImageWorkbenchSettings,
) {
  const rows = await prisma.$queryRaw<
    Array<{ sourceUrl: string; sku: string }>
  >`SELECT j."source_url" AS "sourceUrl",p."sku"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id"
    WHERE j."id"=${id} AND j."status"='processing' LIMIT 1`;
  const job = rows[0];
  if (!job) throw new Error("진행 중인 AI 이미지 작업을 찾을 수 없습니다.");

  const source = await downloadImage(job.sourceUrl);
  const removed = await removeWatermarkWithDewatermark(source, mode);
  const normalized = await sharp(removed.buffer).rotate().jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const settings = enhancementSettings ?? { enhancementEnabled: true, enhancementModel: "RealESRGAN_x2plus" as const, enhancementScale: 2 as const, enhancementStrength: 45 };
  if (!settings.enhancementEnabled) {
    const preview = await sharp(normalized).resize(540, 860, { fit: "fill" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const review = await uploadBufferToR2({ buffer: preview, key: `ai-image-reviews/${safeProductNumber}/${Date.now()}-dewatermark.jpg`, contentType: "image/jpeg", cacheControl: "no-cache" });
    await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='review',"preview_url"=${review.url},"processed_at"=NOW(),"error"='워터마크 제거 완료 · 화질 개선은 설정에서 꺼져 있습니다.' WHERE "id"=${id}`;
    return review.url;
  }
  const uploaded = await uploadBufferToR2({
    buffer: normalized,
    key: `ai-image-intermediate/${safeProductNumber}/${Date.now()}-dewatermark.jpg`,
    contentType: "image/jpeg",
    cacheControl: "no-cache",
  });
  await prisma.$executeRaw`UPDATE "ai_image_jobs"
    SET "status"='enhancement_queued',"dewatermark_url"=${uploaded.url},"preview_url"=NULL,"processed_at"=NULL,
        "enhancement_model"=${settings.enhancementModel},"enhancement_scale"=${settings.enhancementScale},"enhancement_strength"=${settings.enhancementStrength},"enhancement_started_at"=NULL,"enhancement_completed_at"=NULL,
        "error"=${`워터마크 제거 완료 · 로컬 화질 개선 대기 (${removed.mode})`}
    WHERE "id"=${id}`;
  return uploaded.url;
}

export async function claimEnhancementJob() {
  const rows = await prisma.$queryRaw<Array<{ id: string; dewatermarkUrl: string; model: string; scale: number; strength: number }>>`
    WITH candidate AS (SELECT "id" FROM "ai_image_jobs" WHERE "status"='enhancement_queued' AND COALESCE("dewatermark_url",'')<>'' ORDER BY "created_at" FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE "ai_image_jobs" SET "status"='enhancing',"enhancement_started_at"=NOW(),"error"=NULL WHERE "id"=(SELECT "id" FROM candidate)
    RETURNING "id","dewatermark_url" AS "dewatermarkUrl",COALESCE("enhancement_model",'RealESRGAN_x2plus') AS "model",COALESCE("enhancement_scale",2) AS "scale",COALESCE("enhancement_strength",45) AS "strength"`;
  return rows[0] ?? null;
}

export async function completeEnhancementJob(id: string, dataUrl: string) {
  const rows = await prisma.$queryRaw<Array<{ sku: string }>>`SELECT p."sku" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."id"=${id} AND j."status"='enhancing' LIMIT 1`;
  if (!rows[0] || !dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("유효한 진행 중 JPEG 화질 개선 작업이 아닙니다.");
  const input = Buffer.from(dataUrl.slice("data:image/jpeg;base64,".length), "base64");
  if (input.length > 15 * 1024 * 1024) throw new Error("개선 결과가 15MB를 넘습니다.");
  const metadata = await sharp(input, { failOn: "error" }).metadata();
  if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width > 12000 || metadata.height > 12000) throw new Error("유효한 크기의 JPEG 개선 결과가 아닙니다.");
  const safeSku = rows[0].sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploaded = await uploadBufferToR2({ buffer: input, key: `ai-image-reviews/${safeSku}/${Date.now()}-enhanced.jpg`, contentType: "image/jpeg", cacheControl: "no-cache" });
  await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='review',"preview_url"=${uploaded.url},"processed_at"=NOW(),"enhancement_completed_at"=NOW(),"error"='워터마크 제거 후 로컬 화질 개선 완료' WHERE "id"=${id} AND "status"='enhancing'`;
  return uploaded.url;
}

export async function retryEnhancementJob(id: string) {
  const changed = await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='enhancement_queued',"error"='화질 개선 재시도 대기',"enhancement_started_at"=NULL WHERE "id"=${id} AND "status"='enhancement_failed' AND COALESCE("dewatermark_url",'')<>''`;
  if (!changed) throw new Error("보존된 제거본이 없거나 재시도할 수 없는 상태입니다.");
}

export async function completeAiJobWithSafeFallback(id: string) {
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

export async function approveAiJob(id: string, userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      productId: string;
      previewUrl: string;
      sku: string;
      urls: string[]; dewatermarkUrl: string | null;
    }>
  >`
    SELECT j."product_id" AS "productId",j."preview_url" AS "previewUrl",p."sku",p."ebay_image_urls" AS "urls",j."dewatermark_url" AS "dewatermarkUrl"
    FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."id"=${id} AND j."status"='pass_ready' LIMIT 1`;
  const job = rows[0];
  if (!job?.previewUrl) throw new Error("검수할 AI 결과가 없습니다.");
  const buffer = await downloadImage(job.previewUrl);
  const safeProductNumber = job.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploaded = await uploadBufferToR2({
    buffer,
    key: `products/${safeProductNumber}/${safeProductNumber}.jpg`,
    contentType: "image/jpeg",
    cacheControl: "no-cache",
  });
  await prisma.$transaction([
    prisma.product.update({
      where: { id: job.productId },
      data: {
        imageUrl: uploaded.url,
        ebayImageUrls: [
          uploaded.url,
          ...(job.urls ?? []).filter((u) => u !== uploaded.url),
        ],
      },
    }),
    prisma.$executeRaw`UPDATE "products" SET "image_source"='lens_workbench' WHERE "id"=${job.productId}`,
    prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='approved',"reviewed_at"=NOW(),"reviewed_by"=${userId} WHERE "id"=${id}`,
    prisma.$executeRaw`INSERT INTO "product_image_history" ("id","product_id","actor_id","action","image_url","previous_urls","metadata") VALUES (${randomUUID()},${job.productId},${userId},'ai_approved',${uploaded.url},${JSON.stringify(job.urls ?? [])}::jsonb,${JSON.stringify({ jobId: id, sourceUrl: job.previewUrl })}::jsonb)`,
  ]);
  const key = job.dewatermarkUrl && r2KeyFromPublicUrl(job.dewatermarkUrl.split("?")[0]);
  if (key?.startsWith("ai-image-intermediate/")) {
    const deleted = await deleteObjectFromR2(key);
    await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "dewatermark_cleanup_at"=${deleted.ok ? Prisma.sql`NOW()` : Prisma.sql`NULL`},"dewatermark_cleanup_error"=${deleted.ok ? null : (deleted.error ?? "중간본 정리 실패")} WHERE "id"=${id}`;
  }
  return uploaded.url;
}
