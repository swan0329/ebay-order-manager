import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { uploadBufferToR2 } from "@/lib/r2";

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
  return prisma.$executeRaw`
    INSERT INTO "ai_image_jobs" ("id","product_id","source_url")
    SELECT gen_random_uuid()::text,p."id",p."image_url" FROM "products" p
    LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"
    WHERE j."id" IS NULL AND p."image_url" IS NOT NULL AND p."image_url"<>''
      AND (p."user_front_image_url" IS NULL OR p."user_front_image_url"='')
      AND COALESCE(p."image_source",'pocamarket') NOT IN ('r2_user_uploaded','lens_workbench')
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p."ebay_image_urls",ARRAY[]::TEXT[])) u WHERE u LIKE '%/products/%/lens-card-%')
    ORDER BY p."sku" LIMIT ${limit}`;
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
      urls: string[];
    }>
  >`
    SELECT j."product_id" AS "productId",j."preview_url" AS "previewUrl",p."sku",p."ebay_image_urls" AS "urls"
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
  return uploaded.url;
}
