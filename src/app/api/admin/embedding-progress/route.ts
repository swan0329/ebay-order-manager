import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const clipEmbeddingDim = 512;

// Returns CLIP embedding completion counts so the UI can show "M / N done".
export async function GET() {
  try {
    await requireApiUser();
    await ensureProductImageMatchColumns();

    const rows = await prisma.$queryRaw<
      Array<{ total: bigint; embedded: bigint; failed: bigint }>
    >`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE (
            CASE
              WHEN jsonb_typeof("image_signature" -> 'clipEmbedding') = 'array'
              THEN jsonb_array_length("image_signature" -> 'clipEmbedding')
              ELSE 0
            END
          ) = ${clipEmbeddingDim}
        )::bigint AS embedded,
        COUNT(*) FILTER (
          WHERE COALESCE("image_signature" ->> 'clipEmbeddingFailed', 'false') = 'true'
        )::bigint AS failed
      FROM "products"
      WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
        AND COALESCE("user_front_image_url", "image_url") <> ''
    `;

    const total = Number(rows[0]?.total ?? 0);
    const embedded = Number(rows[0]?.embedded ?? 0);
    const failed = Number(rows[0]?.failed ?? 0);
    const remaining = Math.max(0, total - embedded - failed);

    return Response.json({ total, embedded, failed, remaining });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
