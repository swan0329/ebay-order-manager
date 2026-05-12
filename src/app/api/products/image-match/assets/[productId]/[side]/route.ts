import { prisma } from "@/lib/prisma";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

type RouteContext = {
  params: Promise<{ productId: string; side: string }>;
};

type ProductImageAssetRow = {
  imageValue: string | null;
};

type LoadedAsset =
  | {
      buffer: Uint8Array;
      headers: Headers;
    }
  | {
      redirectUrl: string;
    };

export async function GET(_request: Request, context: RouteContext) {
  const asset = await loadAsset(context);

  if (!asset) {
    return new Response("Not found", { status: 404 });
  }

  if ("redirectUrl" in asset) {
    return Response.redirect(asset.redirectUrl, 307);
  }

  const body = asset.buffer.buffer.slice(
    asset.buffer.byteOffset,
    asset.buffer.byteOffset + asset.buffer.byteLength,
  ) as ArrayBuffer;

  return new Response(body, { headers: asset.headers });
}

export async function HEAD(_request: Request, context: RouteContext) {
  const asset = await loadAsset(context);

  if (!asset) {
    return new Response(null, { status: 404 });
  }

  if ("redirectUrl" in asset) {
    return Response.redirect(asset.redirectUrl, 307);
  }

  return new Response(null, { headers: asset.headers });
}

async function loadAsset(context: RouteContext): Promise<LoadedAsset | null> {
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
      END AS "imageValue"
    FROM "products"
    WHERE "id" = ${productId}
    LIMIT 1
  `;
  const imageValue = rows[0]?.imageValue?.trim();

  if (!imageValue) {
    return null;
  }

  if (/^https?:\/\//i.test(imageValue)) {
    return { redirectUrl: imageValue };
  }

  const match = imageValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  const buffer = Buffer.from(match[2], "base64");
  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(buffer.length),
    "Content-Type": match[1],
  });

  return { buffer: new Uint8Array(buffer), headers };
}
