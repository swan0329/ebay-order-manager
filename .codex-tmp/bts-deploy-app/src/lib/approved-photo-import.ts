import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { buildPublicR2Url } from "@/lib/r2";

export const approvedPhotoImportSchema = z.object({
  confirmed: z.literal(true),
  dryRun: z.boolean().default(true),
  rows: z.array(z.object({
    sku: z.string().regex(/^\d+(?:_\d+)*$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileName: z.string().regex(/^\d+(?:_\d+)*\.jpg$/i),
    expectedImageUrl: z.string().nullable(),
  })).min(1).max(100),
});

export const approvedPhotoKey = (sha256: string) => `products/bts-approved-photos/${sha256}.jpg`;

type Snapshot = { id: string; sku: string; imageUrl: string | null;
  sourceImageUrl: string | null; imageSource: string | null; ebayImageUrls: string[];
  stockQuantity: number };

export async function approvedPhotoSnapshot() {
  const products = await prisma.$queryRaw<Snapshot[]>`
    SELECT "id", "sku", "image_url" AS "imageUrl", "source_image_url" AS "sourceImageUrl",
      "image_source" AS "imageSource", "ebay_image_urls" AS "ebayImageUrls",
      "stock_quantity" AS "stockQuantity"
    FROM "products" WHERE "brand"='BTS' ORDER BY "sku"`;
  const history = await prisma.$queryRaw<Array<{ sku: string; count: number }>>`
    SELECT p."sku",COUNT(*)::int AS "count" FROM "product_image_history" h
    JOIN "products" p ON p."id"=h."product_id"
    WHERE p."brand"='BTS' AND h."metadata"->>'importSource'='BTS_상품번호_JPG'
    GROUP BY p."sku"`;
  return { products, history, publicBaseUrl: buildPublicR2Url("products").replace(/\/products$/, "") };
}

export async function importApprovedPhotos(input: z.infer<typeof approvedPhotoImportSchema>, actorId: string) {
  const skus = input.rows.map(r => r.sku);
  if (new Set(skus).size !== skus.length) throw new Error("Duplicate SKU");
  return prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Snapshot[]>`
      SELECT "id", "sku", "image_url" AS "imageUrl", "source_image_url" AS "sourceImageUrl",
        "image_source" AS "imageSource", "ebay_image_urls" AS "ebayImageUrls",
        "stock_quantity" AS "stockQuantity"
      FROM "products" WHERE "brand"='BTS' AND "sku" IN (${Prisma.join(skus)})
      ORDER BY "sku" FOR UPDATE`;
    if (current.length !== skus.length) throw new Error("Missing BTS SKU");
    const bySku = new Map(current.map(p => [p.sku, p]));
    const changes = input.rows.map(row => ({ row, product: bySku.get(row.sku)!, url: buildPublicR2Url(approvedPhotoKey(row.sha256)) }))
      .filter(({ product, url }) => product.imageUrl !== url || product.imageSource !== "lens_workbench" || product.ebayImageUrls?.length !== 1 || product.ebayImageUrls[0] !== url);
    for (const { row, product } of changes) {
      if (product.imageUrl !== row.expectedImageUrl) throw new Error("Image changed since preview");
    }
    if (!changes.length || input.dryRun) return { updated: 0, candidates: changes.length, skipped: current.length - changes.length, dryRun: input.dryRun };
    const ids = changes.map(c => c.product.id);
    const jobs = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id","status" FROM "ai_image_jobs" WHERE "product_id" IN (${Prisma.join(ids)}) FOR UPDATE`;
    if (jobs.some(j => ["processing", "running"].includes(j.status))) throw new Error("AI job is still processing");
    await tx.$executeRaw`
      UPDATE "products" p SET "source_image_url"=COALESCE(p."source_image_url",p."image_url"),
        "image_url"=v.url, "ebay_image_urls"=ARRAY[v.url]::text[],
        "image_source"='lens_workbench', "verified_at"=NOW(), "updated_at"=NOW()
      FROM (VALUES ${Prisma.join(changes.map(c => Prisma.sql`(${c.product.id},${c.url})`))}) AS v(id,url)
      WHERE p."id"=v.id`;
    await tx.$executeRaw`
      INSERT INTO "product_image_history" ("id","product_id","actor_id","action","image_url","previous_urls","metadata")
      VALUES ${Prisma.join(changes.map(c => Prisma.sql`(${randomUUID()},${c.product.id},${actorId},'lens_saved',${c.url},
        ${JSON.stringify([...new Set([c.product.imageUrl, ...(c.product.ebayImageUrls ?? [])].filter(Boolean))])}::jsonb,
        ${JSON.stringify({ importSource: "BTS_상품번호_JPG", origin: "user_approved_photograph", fileName: c.row.fileName, sha256: c.row.sha256,
          previousImageSource: c.product.imageSource, previousSourceImageUrl: c.product.sourceImageUrl })}::jsonb)`))}`;
    // Retire pending automation; no AI-generated provenance or stock is invented.
    await tx.$executeRaw`
      UPDATE "ai_image_jobs" SET "status"='cancelled', "error"='관리자가 촬영본을 최종 이미지로 채택',
        "reviewed_at"=NOW(),"reviewed_by"=${actorId}
      WHERE "product_id" IN (${Prisma.join(ids)}) AND "status" NOT IN ('approved','cancelled')`;
    return { updated: changes.length, candidates: changes.length, skipped: current.length - changes.length, dryRun: false };
  }, { timeout: 20000 });
}
