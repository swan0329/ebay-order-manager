import "server-only";

import { getShopifyConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { attachShopifyVariantImages, replaceShopifyProductImages } from "@/lib/services/shopifyService";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";

/**
 * 이미 생성된 Shopify 상품에 승인된 원본 사진을 다시 연결한다.
 * 가격·재고·옵션은 전혀 수정하지 않으며, 상품 ID가 하나로 일치할 때만 실행한다.
 */
export async function repairShopifyProductImages(productIds: string[]) {
  const [products, readyImages] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { productListings: { where: { channel: "SHOPIFY" }, take: 1 } },
    }),
    getVariationListingReadyImages(),
  ]);
  if (products.length !== productIds.length) throw new Error("이미지 보정 대상 상품을 찾을 수 없습니다.");
  const readyImageById = new Map(readyImages.map((image) => [image.id, image.listingImageUrl]));
  const missing = products.filter((product) => !readyImageById.has(product.id));
  if (missing.length) throw new Error(`최종 승인 이미지가 없는 옵션이 ${missing.length}개 있어 보정하지 않았습니다.`);
  const externalIds = [...new Set(products.flatMap((product) => {
    const externalId = product.shopifyProductId ?? product.productListings[0]?.externalId;
    return externalId ? [externalId] : [];
  }))];
  if (externalIds.length !== 1) throw new Error("하나의 Shopify 상품으로 연결된 단품 또는 묶음상품만 이미지 보정할 수 있습니다.");

  // Shopify의 옵션 사진은 상품 이미지와 별개다. eBay 보조 이미지 배열을 섞지
  // 않고, 각 카드의 승인된 최종 이미지 하나를 옵션 사진의 기준으로 삼는다.
  const imageByProductId = new Map(products.map((product) => [product.id, readyImageById.get(product.id)!]));
  const urls = [...new Set([...imageByProductId.values()])];
  // 새 승인 이미지를 먼저 접수한 뒤에 기존 Shopify 사진을 지운다. 가격, 재고,
  // 옵션은 이 경로에서 변경하지 않는다.
  const result = await replaceShopifyProductImages(getShopifyConfig(), externalIds[0], urls);
  const mediaIdByUrl = new Map(result.media.map((media) => [media.sourceUrl, media.mediaId]));
  const assignments = products.map((product) => {
    const metadata = product.productListings[0]?.metadata;
    const variantId = product.shopifyVariantId ?? (
      metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).variantId === "string"
        ? (metadata as Record<string, string>).variantId
        : null
    );
    if (!variantId) throw new Error(`${product.sku}: Shopify 옵션 ID가 없어 이미지 연결을 시작하지 않았습니다.`);
    const sourceUrl = imageByProductId.get(product.id)!;
    const mediaId = mediaIdByUrl.get(sourceUrl);
    if (!mediaId) throw new Error(`${product.sku}: Shopify가 옵션 사진 미디어 ID를 반환하지 않았습니다.`);
    return { variantId, sourceUrl, mediaId };
  });
  const variantsUpdated = await attachShopifyVariantImages(getShopifyConfig(), externalIds[0], assignments);
  await prisma.product.updateMany({
    where: { id: { in: products.map((product) => product.id) } },
    data: { shopifyLastUploadedAt: new Date(), shopifyUploadError: null },
  });
  return { productId: externalIds[0], variantsUpdated, ...result };
}
