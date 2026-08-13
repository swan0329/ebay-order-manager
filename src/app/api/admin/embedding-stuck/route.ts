import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clipEmbeddingDim = 512;

// Lists every product that still lacks a valid CLIP embedding — i.e. the rows
// the embedding queue keeps returning. Optionally probes each image URL
// (?check=1) so you can see which ones are unreachable (the cause of the
// infinite-loop / stuck items).
export async function GET(request: Request) {
  try {
    await requireApiUser();
    await ensureProductImageMatchColumns();

    const url = new URL(request.url);
    const check = url.searchParams.get("check") === "1";
    const reset = url.searchParams.get("reset") === "1";

    // Clear the "failed" flags so the queue will retry these items (use after
    // fixing the underlying image URLs).
    if (reset) {
      const cleared = await prisma.$executeRaw`
        UPDATE "products"
        SET "image_signature" = "image_signature"
              - 'clipEmbeddingFailed' - 'clipEmbeddingFailedReason' - 'clipEmbeddingFailedAt',
            "updated_at" = CURRENT_TIMESTAMP
        WHERE COALESCE("image_signature" ->> 'clipEmbeddingFailed', 'false') = 'true'
      `;
      return Response.json({ ok: true, reset: true, cleared });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        sku: string;
        productName: string;
        imageUrl: string | null;
        failed: boolean;
        failedReason: string | null;
      }>
    >`
      SELECT
        "id",
        "sku",
        "product_name" AS "productName",
        COALESCE("user_front_image_url", "image_url") AS "imageUrl",
        (COALESCE("image_signature" ->> 'clipEmbeddingFailed', 'false') = 'true') AS "failed",
        ("image_signature" ->> 'clipEmbeddingFailedReason') AS "failedReason"
      FROM "products"
      WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
        AND COALESCE("user_front_image_url", "image_url") <> ''
        AND (
          "image_signature" IS NULL
          OR ("image_signature" -> 'clipEmbedding') IS NULL
          OR jsonb_typeof("image_signature" -> 'clipEmbedding') <> 'array'
          OR (
            CASE
              WHEN jsonb_typeof("image_signature" -> 'clipEmbedding') = 'array'
              THEN jsonb_array_length("image_signature" -> 'clipEmbedding')
              ELSE 0
            END
          ) <> ${clipEmbeddingDim}
        )
      ORDER BY "image_fingerprint_updated_at" ASC NULLS FIRST, "updated_at" DESC
    `;

    // Products whose image URL is blank/null can never be embedded either —
    // surface them separately for completeness.
    const noImageCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "products"
      WHERE COALESCE("user_front_image_url", "image_url") IS NULL
         OR COALESCE("user_front_image_url", "image_url") = ''
    `;

    let items = rows.map((r) => ({ ...r, reachable: null as boolean | null, httpStatus: null as number | null }));

    if (check) {
      items = await Promise.all(
        rows.map(async (r) => {
          if (!r.imageUrl) return { ...r, reachable: false, httpStatus: null };
          try {
            const res = await fetch(r.imageUrl, {
              method: "GET",
              signal: AbortSignal.timeout(10_000),
            });
            return { ...r, reachable: res.ok, httpStatus: res.status };
          } catch {
            return { ...r, reachable: false, httpStatus: null };
          }
        }),
      );
    }

    return Response.json({
      stuckCount: rows.length,
      failedCount: rows.filter((r) => r.failed).length,
      noImageCount: Number(noImageCount[0]?.count ?? 0),
      checked: check,
      unreachableCount: check ? items.filter((i) => !i.reachable).length : null,
      items,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
