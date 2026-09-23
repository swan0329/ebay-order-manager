import type { Product } from "@/generated/prisma";
import { ensureListingWatermarkedImages } from "@/lib/ebay-watermarked-images";
import type { ProductImageExtras } from "@/lib/ebay-listing-fields";
import { prisma } from "@/lib/prisma";

type ListingImageProduct = Pick<Product, "imageUrl" | "ebayImageUrls"> & ProductImageExtras & {
  imageSource?: string | null;
};

function isSupplierImageUrl(value: string) {
  try {
    const url = new URL(value);
    return /(^|\.)(pocamarket\.com|infludeo\.com)$/i.test(url.hostname) || url.pathname.includes("/media/photocard_blur/");
  } catch { return true; }
}

/**
 * One canonical source-image rule for every channel.
 * The explicitly approved front image wins. Legacy galleries are deliberately
 * reduced to one fallback because older approval paths could append unreviewed
 * candidate images. A back image must be approved through a future explicit
 * front/back workflow before it can be published.
 * Channel derivatives are never accepted as a new source, preventing double watermarks.
 */
export function collectListingSourceImageUrls(product: ListingImageProduct) {
  // lens_workbench의 imageUrl은 사람이 저장·승인한 가공 결과다. 이 경우
  // 과거 촬영본(userFrontImageUrl)을 다시 앞세우면 가공 전 이미지가 게시된다.
  const candidates = product.imageSource === "lens_workbench"
    ? [product.imageUrl, product.userFrontImageUrl]
    : [product.userFrontImageUrl, product.imageUrl];
  const selected = candidates.find((url) => {
    if (typeof url !== "string" || !url.trim()) return false;
    if (isSupplierImageUrl(url)) return false;
    if (url.trim() === product.sourceImageUrl?.trim()) return false;
    return !url.includes("/products/ebay-watermarked/") &&
      !url.includes("/products/channel-watermarked/");
  });
  if (!selected) return [];
  return [selected.trim()];
}

function isChannelDerivative(url: string) {
  return url.includes("/products/ebay-watermarked/") ||
    url.includes("/products/channel-watermarked/");
}

export async function resolveApprovedListingSourceImageUrls<
  T extends ListingImageProduct & { id: string }
>(product: T) {
  const hasApproval = ["lens_workbench", "r2_user_uploaded", "user_uploaded"].includes(product.imageSource ?? "") || Boolean(product.userFrontImageUrl);
  const direct = hasApproval ? collectListingSourceImageUrls(product) : [];
  if (direct.length) return direct;

  // Older code sometimes replaced Product.imageUrl/ebayImageUrls with a
  // channel derivative. Recover only from explicit approval history; never
  // promote search candidates or the external channel gallery.
  const history = await prisma.$queryRaw<Array<{ imageUrl: string | null }>>`
    SELECT "image_url" AS "imageUrl"
    FROM "product_image_history"
    WHERE "product_id" = ${product.id}
      AND "action" IN ('lens_saved', 'worker_approved', 'ai_approved')
      AND "image_url" IS NOT NULL
    ORDER BY "created_at" DESC
    LIMIT 20
  `;
  const approved = history
    .map((row) => row.imageUrl?.trim() ?? "")
    .find((url) => Boolean(url) && !isSupplierImageUrl(url) && !isChannelDerivative(url) && url !== product.sourceImageUrl?.trim());
  return approved ? [approved] : [];
}

export async function prepareProductListingSource<
  T extends Pick<Product, "id" | "sku" | "imageUrl" | "ebayImageUrls">
>(product: T) {
  const sourceRows = await prisma.$queryRaw<Array<{ imageSource: string | null; sourceImageUrl: string | null; userFrontImageUrl: string | null }>>`
    SELECT "image_source" AS "imageSource", "source_image_url" AS "sourceImageUrl", "user_front_image_url" AS "userFrontImageUrl"
    FROM "products" WHERE "id" = ${product.id} LIMIT 1
  `;
  const imageSource = sourceRows[0]?.imageSource ?? null;
  const sourceUrls = await resolveApprovedListingSourceImageUrls({ ...product, ...sourceRows[0], imageSource });
  if (!sourceUrls.length) throw new Error(`${product.sku}: 승인된 등록 원본 이미지가 없습니다.`);
  return { ...product, imageSource, imageUrl: sourceUrls[0], ebayImageUrls: sourceUrls, listingImageIsImageWork: imageSource === "lens_workbench" };
}

export async function prepareProductChannelImages<
  T extends Pick<Product, "id" | "sku" | "imageUrl" | "ebayImageUrls">
>(userId: string, product: T) {
  const source = await prepareProductListingSource(product);
  const sourceUrls = source.ebayImageUrls;
  const imageUrls = await ensureListingWatermarkedImages(userId, sourceUrls, {
    backgroundEligible: source.listingImageIsImageWork,
  });
  return { ...product, imageUrl: imageUrls[0] ?? null, ebayImageUrls: imageUrls };
}

export async function withCentralListingImages<T extends ListingImageProduct>(
  userId: string,
  products: T[],
) {
  const sourcesByProduct = products.map(collectListingSourceImageUrls);
  const rendered = await ensureListingWatermarkedImages(userId, sourcesByProduct.flat());
  let offset = 0;
  return products.map((product, index) => {
    const urls = rendered.slice(offset, offset + sourcesByProduct[index].length);
    offset += sourcesByProduct[index].length;
    return { ...product, imageUrl: urls[0] ?? null, ebayImageUrls: urls };
  });
}
