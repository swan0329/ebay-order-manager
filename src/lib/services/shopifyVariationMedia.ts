import "server-only";

import type { VariationListingGroup } from "@/lib/variation-listing-groups";
import { variationParentSku } from "@/lib/variation-listing-groups";
import { createVariationThumbnail } from "@/lib/variation-thumbnail";
import { variationThumbnailHash, thumbnailIsCurrent } from "@/lib/variation-thumbnail-state";
import { resolveListingWatermark } from "@/lib/listing-watermark";
import { prisma } from "@/lib/prisma";
import { uploadBufferToR2 } from "@/lib/r2";

/**
 * eBay와 Shopify가 동일한 묶음 대표 이미지를 쓴다. 첫 번째 Shopify 상품 미디어는
 * 이 제작 썸네일이고, 각 카드 원본은 아래 옵션별 미디어 연결에만 사용한다.
 */
export async function ensureShopifyVariationThumbnail(
  userId: string,
  group: VariationListingGroup,
) {
  const watermark = await resolveListingWatermark(userId);
  const hash = variationThumbnailHash(group, watermark.signature);
  const existing = await prisma.variationListingState.findUnique({
    where: { userId_groupKey: { userId, groupKey: group.key } },
  });
  if (thumbnailIsCurrent(existing, hash) && existing?.thumbnailUrl) return existing.thumbnailUrl;

  const base = { userId, groupKey: group.key, parentSku: variationParentSku(group.key), title: group.title };
  await prisma.variationListingState.upsert({
    where: { userId_groupKey: { userId, groupKey: group.key } },
    create: { ...base, thumbnailStatus: "GENERATING", thumbnailHash: hash, thumbnailProductIds: group.products.map((product) => product.id) },
    update: { title: group.title, thumbnailStatus: "GENERATING", thumbnailHash: hash, thumbnailProductIds: group.products.map((product) => product.id), thumbnailError: null },
  });
  try {
    const imageUrls = group.products.map((product) => product.imageUrl).filter((url): url is string => Boolean(url));
    if (imageUrls.length !== group.products.length) throw new Error("묶음 옵션의 최종 이미지가 모두 준비되지 않았습니다.");
    const buffer = await createVariationThumbnail({
      groupName: group.groupName,
      albumName: `${group.albumName} · ${group.versionName}`,
      imageUrls,
      watermarkLogo: watermark.logo,
      watermarkText: watermark.watermarkText ?? undefined,
      watermarkOpacity: watermark.watermarkOpacity,
      watermarkLogoSize: watermark.watermarkLogoSize,
      watermarkGap: watermark.watermarkGap,
    });
    const uploaded = await uploadBufferToR2({ buffer, key: `products/variation-thumbnails/${hash}.jpg`, contentType: "image/jpeg" });
    await prisma.variationListingState.update({
      where: { userId_groupKey: { userId, groupKey: group.key } },
      data: { thumbnailStatus: "READY", thumbnailUrl: uploaded.url, thumbnailKey: uploaded.key, thumbnailHash: hash, thumbnailProductIds: group.products.map((product) => product.id), thumbnailGeneratedAt: new Date(), thumbnailError: null },
    });
    return uploaded.url;
  } catch (error) {
    await prisma.variationListingState.update({
      where: { userId_groupKey: { userId, groupKey: group.key } },
      data: { thumbnailStatus: "FAILED", thumbnailError: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

/** Shared by Shopify creation and confirmed eBay representative-image repair. */
export const ensureVariationThumbnail = ensureShopifyVariationThumbnail;
