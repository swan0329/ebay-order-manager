import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { uploadBufferToR2 } from "@/lib/r2";
import { productImageExtrasById, withProductImageExtras } from "@/lib/product-export-image-extras";

export type VariationReadyImage = {
  id: string;
  listingImageUrl: string;
};

export async function withVariationListingMetadata<T extends { id: string }>(products: T[]) {
  return withProductImageExtras(products, await productImageExtrasById(products.map((product) => product.id)));
}

export function isPublicListingImageUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function decodeImageDataUrl(value: string) {
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const contentType = `image/${match[1]}`;
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  return buffer.length ? { buffer, contentType, extension } : null;
}

/** Move approved browser data URLs to R2 before they are used as eBay option images. */
export async function promoteVariationListingImagesToR2(images: VariationReadyImage[]) {
  const candidates = images.filter((image) => image.listingImageUrl.startsWith("data:image/"));
  if (!candidates.length) return 0;
  let promoted = 0;
  for (const candidate of candidates) {
    const decoded = decodeImageDataUrl(candidate.listingImageUrl);
    if (!decoded) continue;
    const hash = createHash("sha256").update(decoded.buffer).digest("hex").slice(0, 24);
    const uploaded = await uploadBufferToR2({
      buffer: decoded.buffer,
      key: `products/variation-options/${candidate.id}-${hash}.${decoded.extension}`,
      contentType: decoded.contentType,
    });
    const imageUrlUpdated = await prisma.$executeRaw`
      UPDATE "products"
      SET "image_url" = ${uploaded.url}, "updated_at" = NOW()
      WHERE "id" = ${candidate.id} AND "image_url" = ${candidate.listingImageUrl}
    `;
    const frontUrlUpdated = imageUrlUpdated ? 0 : await prisma.$executeRaw`
      UPDATE "products"
      SET "user_front_image_url" = ${uploaded.url}, "updated_at" = NOW()
      WHERE "id" = ${candidate.id} AND "user_front_image_url" = ${candidate.listingImageUrl}
    `;
    if (imageUrlUpdated || frontUrlUpdated) promoted += 1;
  }
  return promoted;
}

/** Only cards whose final listing image has actually been completed/approved. */
export async function getVariationListingReadyImages() {
  const rows = await prisma.$queryRaw<VariationReadyImage[]>`
    SELECT p."id"
      , CASE
          WHEN EXISTS (
            SELECT 1 FROM "ai_image_jobs" j
            WHERE j."product_id" = p."id" AND j."status" = 'approved'
          ) THEN p."image_url"
          ELSE p."user_front_image_url"
        END AS "listingImageUrl"
    FROM "products" p
    WHERE (
      p."stock_quantity" > 0
      OR COALESCE(p."pocamarket_available_count", 0) > 0
    )
    AND (
      COALESCE(p."user_front_image_url", '') <> ''
      OR EXISTS (
        SELECT 1 FROM "ai_image_jobs" j
        WHERE j."product_id" = p."id" AND j."status" = 'approved'
      )
    )
    AND COALESCE(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM "ai_image_jobs" j
          WHERE j."product_id" = p."id" AND j."status" = 'approved'
        ) THEN p."image_url"
        ELSE p."user_front_image_url"
      END,
      ''
    ) <> ''
  `;
  return rows;
}

/** Final approved images for an already-published group, including sold-out members. */
export async function getVariationListingImagesByIds(productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return [];
  return prisma.$queryRaw<VariationReadyImage[]>`
    SELECT p."id"
      , CASE
          WHEN EXISTS (
            SELECT 1 FROM "ai_image_jobs" j
            WHERE j."product_id" = p."id" AND j."status" = 'approved'
          ) THEN p."image_url"
          ELSE p."user_front_image_url"
        END AS "listingImageUrl"
    FROM "products" p
    WHERE p."id" IN (${Prisma.join(ids)})
      AND COALESCE(
        CASE
          WHEN EXISTS (
            SELECT 1 FROM "ai_image_jobs" j
            WHERE j."product_id" = p."id" AND j."status" = 'approved'
          ) THEN p."image_url"
          ELSE p."user_front_image_url"
        END,
        ''
      ) <> ''
  `;
}
