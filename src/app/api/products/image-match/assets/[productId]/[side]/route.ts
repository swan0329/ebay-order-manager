import { getObjectFromR2 } from "@/lib/r2";
import { prisma } from "@/lib/prisma";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

type RouteContext = {
  params: Promise<{ productId: string; side: string }>;
};

type ProductImageAssetRow = {
  r2Key: string | null;
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
        WHEN ${side} = 'back' THEN "user_back_r2_key"
        ELSE "user_front_r2_key"
      END AS "r2Key",
      CASE
        WHEN ${side} = 'back' THEN "user_back_image_url"
        ELSE "user_front_image_url"
      END AS "imageValue"
    FROM "products"
    WHERE "id" = ${productId}
    LIMIT 1
  `;
  const r2Key = rows[0]?.r2Key?.trim() || null;
  const imageValue = rows[0]?.imageValue?.trim();

  if (!r2Key && !imageValue) {
    return null;
  }

  // Fetch directly from R2 via S3 API to bypass Cloudflare CDN cache
  if (r2Key) {
    const r2Data = await getObjectFromR2(r2Key);

    if (r2Data) {
      const headers = new Headers({
        "Content-Type": r2Data.contentType,
        "Cache-Control": "no-store",
        "Content-Length": String(r2Data.buffer.length),
      });
      return { buffer: r2Data.buffer, headers };
    }
  }

  if (!imageValue) {
    return null;
  }

  if (/^https?:\/\//i.test(imageValue)) {
    // Fallback: fetch via URL (for items without an r2_key stored)
    const r2Res = await fetch(imageValue);

    if (!r2Res.ok) return null;

    const buffer = new Uint8Array(await r2Res.arrayBuffer());
    const contentType = r2Res.headers.get("content-type") ?? "image/jpeg";
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Length": String(buffer.length),
    });

    return { buffer, headers };
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
