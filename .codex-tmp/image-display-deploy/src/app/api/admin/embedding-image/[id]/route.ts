import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser();
    const { id } = await context.params;

    const rows = await prisma.$queryRaw<Array<{ imageUrl: string | null }>>`
      SELECT COALESCE("user_front_image_url", "image_url") AS "imageUrl"
      FROM "products"
      WHERE "id" = ${id}
      LIMIT 1
    `;

    const imageUrl = rows[0]?.imageUrl;

    if (!imageUrl) {
      return jsonError("Product image not found", 404);
    }

    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });

    if (!response.ok) {
      return jsonError(`Upstream fetch failed (${response.status})`, 502);
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
