import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const clipEmbeddingDim = 512;

const schema = z.union([
  z.object({
    productId: z.string().min(1),
    embedding: z.array(z.number()).length(clipEmbeddingDim),
  }),
  z.object({
    productId: z.string().min(1),
    failed: z.literal(true),
    reason: z.string().max(500).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    await requireApiUser();
    await ensureProductImageMatchColumns();

    const body = schema.parse(await request.json());

    // Mark an item that can't be embedded (unreachable/broken image) so the
    // queue stops returning it — this is what prevents the infinite loop.
    if ("failed" in body) {
      await prisma.$executeRaw`
        UPDATE "products"
        SET
          "image_signature" = COALESCE("image_signature", '{}'::jsonb)
            || jsonb_build_object(
                 'clipEmbeddingFailed', 'true',
                 'clipEmbeddingFailedReason', ${body.reason ?? "embed/fetch failed"},
                 'clipEmbeddingFailedAt', to_jsonb(CURRENT_TIMESTAMP)
               ),
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${body.productId}
      `;
      return Response.json({ ok: true, marked: "failed" });
    }

    const normalized = normalizeVector(body.embedding);

    await prisma.$executeRaw`
      UPDATE "products"
      SET
        "image_signature" = (COALESCE("image_signature", '{}'::jsonb)
          || jsonb_build_object('clipEmbedding', ${JSON.stringify(normalized)}::jsonb))
          - 'clipEmbeddingFailed' - 'clipEmbeddingFailedReason' - 'clipEmbeddingFailedAt',
        "image_fingerprint_updated_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${body.productId}
    `;

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    if (error instanceof z.ZodError) {
      return jsonError("Invalid embedding payload", 422, error.flatten());
    }
    return jsonError(asErrorMessage(error), 500);
  }
}

function normalizeVector(values: number[]): number[] {
  let sumSquares = 0;
  for (const value of values) {
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return values.slice();
  return values.map((value) => value / norm);
}
