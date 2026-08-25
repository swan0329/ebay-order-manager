import "server-only";

import { getShopifyConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { attachShopifyVariantImages, inspectShopifyProductImageState, moveShopifyProductMediaToFirst, replaceShopifyProductImages } from "@/lib/services/shopifyService";
import { ensureShopifyVariationThumbnail } from "@/lib/services/shopifyVariationMedia";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";
import { getVariationListingReadyImages, promoteVariationListingImagesToR2, withVariationListingMetadata } from "@/lib/variation-listing-products";
import { createWatermarkedListingImage, resolveListingWatermark } from "@/lib/listing-watermark";

/**
 * 이미 생성된 Shopify 상품에 승인된 원본 사진을 다시 연결한다.
 * 가격·재고·옵션은 전혀 수정하지 않으며, 상품 ID가 하나로 일치할 때만 실행한다.
 */
export async function repairShopifyProductImages(productIds: string[], userId: string) {
  let readyImages = await getVariationListingReadyImages();
  if (await promoteVariationListingImagesToR2(readyImages.filter((image) => productIds.includes(image.id)))) {
    readyImages = await getVariationListingReadyImages();
  }
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { productListings: { where: { channel: "SHOPIFY" }, take: 1 } },
  });
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
  const watermark = await resolveListingWatermark(userId);
  const individualImages = await Promise.all(products.map(async (product) => [
    product.id,
    await createWatermarkedListingImage(readyImageById.get(product.id)!, watermark),
  ] as const));
  const imageByProductId = new Map(individualImages.map(([productId, image]) => [productId, image.url]));
  // 콜라주 대표 썸네일은 원본 카드들 위에 워터마크를 한 번만 얹는다. 이미
  // 워터마크된 옵션용 복사본을 재료로 삼으면 대표 이미지가 이중 처리된다.
  const groupedProducts = await withVariationListingMetadata(products);
  const grouped = buildVariationListingGroups(groupedProducts.map((product) => ({ ...product, imageUrl: readyImageById.get(product.id)!, ebayImageUrls: [] }))).groups;
  const group = grouped.length === 1 && grouped[0].products.length === products.length ? grouped[0] : null;
  // 묶음은 제작한 콜라주 썸네일을 항상 첫 상품 미디어로 둔다. 옵션 이미지는
  // 그 뒤에 두고, 각각 해당 옵션과만 연결한다.
  const thumbnailUrl = group ? await ensureShopifyVariationThumbnail(userId, group) : null;
  const variantAssignments = products.map((product) => {
    const metadata = product.productListings[0]?.metadata;
    const variantId = product.shopifyVariantId ?? (
      metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).variantId === "string"
        ? (metadata as Record<string, string>).variantId
        : null
    );
    if (!variantId) throw new Error(`${product.sku}: Shopify 옵션 ID가 없어 이미지 연결을 시작하지 않았습니다.`);
    return { variantId, sourceUrl: imageByProductId.get(product.id)! };
  });
  const config = getShopifyConfig();
  const completedAt = new Date();
  const recordCompleted = async () => prisma.$transaction([
    prisma.product.updateMany({
      where: { id: { in: products.map((product) => product.id) } },
      data: { shopifyLastUploadedAt: completedAt, shopifyUploadError: null },
    }),
    ...products.flatMap((product) => {
      const listing = product.productListings[0];
      if (!listing) return [];
      const previous = listing.metadata && typeof listing.metadata === "object" && !Array.isArray(listing.metadata)
        ? listing.metadata as Record<string, unknown>
        : {};
      return [prisma.productListing.update({
        where: { id: listing.id },
        data: { metadata: { ...previous, imageSync: { status: "READY", sourceImageUrl: readyImageById.get(product.id), salesImageUrl: imageByProductId.get(product.id), watermarkSignature: watermark.signature, watermarkApplied: watermark.applyToIndividualCards, thumbnailUrl, completedAt: completedAt.toISOString() } } },
      })];
    }),
  ]);

  // 이전 요청이 Shopify에 이미 반영된 경우에는 다시 업로드·삭제·순서 변경을
  // 하지 않는다. 실제 대표 사진과 각 옵션 연결을 읽기 전용으로 대조한 뒤
  // 내부 완료 기록만 복구해 목록에서 즉시 사라지게 한다.
  const existing = await inspectShopifyProductImageState(config, externalIds[0], { thumbnailUrl, variants: variantAssignments });
  if (existing.current) {
    await recordCompleted();
    return {
      productId: externalIds[0], thumbnailUrl, variantsUpdated: 0,
      requested: new Set([...(thumbnailUrl ? [thumbnailUrl] : []), ...imageByProductId.values()]).size,
      attached: 0, alreadyAttached: variantAssignments.length, processing: 0, removed: 0,
      media: [...existing.mediaBySourceUrl.entries()].map(([sourceUrl, mediaId]) => ({ sourceUrl, mediaId })),
      reconciled: true,
    };
  }

  const urls = [...new Set([...(thumbnailUrl ? [thumbnailUrl] : []), ...imageByProductId.values()])];
  // 새 승인 이미지를 먼저 접수한 뒤에 기존 Shopify 사진을 지운다. 가격, 재고,
  // 옵션은 이 경로에서 변경하지 않는다.
  const result = await replaceShopifyProductImages(config, externalIds[0], urls);
  const mediaIdByUrl = new Map(result.media.map((media) => [media.sourceUrl, media.mediaId]));
  if (thumbnailUrl) {
    const thumbnailMediaId = mediaIdByUrl.get(thumbnailUrl);
    if (!thumbnailMediaId) throw new Error("Shopify가 제작된 묶음 썸네일의 미디어 ID를 반환하지 않았습니다.");
    await moveShopifyProductMediaToFirst(config, externalIds[0], thumbnailMediaId);
  }
  const assignments = variantAssignments.map((assignment) => {
    const mediaId = mediaIdByUrl.get(assignment.sourceUrl);
    if (!mediaId) throw new Error(`${assignment.variantId}: Shopify가 옵션 사진 미디어 ID를 반환하지 않았습니다.`);
    return { ...assignment, mediaId };
  });
  const variantsUpdated = await attachShopifyVariantImages(config, externalIds[0], assignments);
  await recordCompleted();
  return { productId: externalIds[0], thumbnailUrl, variantsUpdated, ...result };
}
