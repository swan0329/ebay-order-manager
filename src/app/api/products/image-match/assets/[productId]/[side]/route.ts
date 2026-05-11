import { prisma } from "@/lib/prisma";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

type RouteContext = {
  params: Promise<{ productId: string; side: string }>;
};

type ProductImageAssetRow = {
  dataUrl: string | null;
};

export async function GET(_request: Request, context: RouteContext) {
  const asset = await loadAsset(context);

  if (!asset) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(asset.buffer, {
    headers: asset.headers,
  });
}

export async function HEAD(_request: Request, context: RouteContext) {
  const asset = await loadAsset(context);

  if (!asset) {
    return new Response(null, { status: 404 });
  }

  return new Response(null, {
    headers: asset.headers,
  });
}

async function loadAsset(context: RouteContext) {
  const { productId, side } = await context.params;

  if (side !== "front" && side !== "back") {
    return null;
  }

  await ensureProductImageMatchColumns();

  const rows = await prisma.$queryRaw<ProductImageAssetRow[]>`
    SELECT
      CASE
        WHEN ${side} = 'back' THEN "user_back_image_url"
        ELSE "user_front_image_url"
      END AS "dataUrl"
    FROM "products"
    WHERE "id" = ${productId}
    LIMIT 1
  `;
  const dataUrl = rows[0]?.dataUrl;

  if (!dataUrl) {
    return null;
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  const buffer = Buffer.from(match[2], "base64");
  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(buffer.length),
    "Content-Type": match[1],
  });

  return { buffer, headers };
}
