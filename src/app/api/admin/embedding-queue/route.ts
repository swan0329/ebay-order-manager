import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const clipEmbeddingDim = 512;

export async function GET(request: Request) {
  try {
    await requireApiUser();
    await ensureProductImageMatchColumns();

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 10));

    const remainingRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "products"
      WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
        AND COALESCE("user_front_image_url", "image_url") <> ''
        AND COALESCE("image_signature" ->> 'clipEmbeddingFailed', 'false') <> 'true'
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
    `;

    const items = await prisma.$queryRaw<Array<{ id: string; imageUrl: string | null }>>`
      SELECT
        "id",
        COALESCE("user_front_image_url", "image_url") AS "imageUrl"
      FROM "products"
      WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
        AND COALESCE("user_front_image_url", "image_url") <> ''
        AND COALESCE("image_signature" ->> 'clipEmbeddingFailed', 'false') <> 'true'
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
      LIMIT ${limit}
    `;

    return Response.json({
      remaining: Number(remainingRows[0]?.count ?? 0),
      items: items.filter((item) => item.imageUrl),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
