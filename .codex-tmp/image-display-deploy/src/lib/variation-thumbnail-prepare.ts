import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { variationParentSku, type VariationListingGroup } from "@/lib/variation-listing-groups";
import { variationThumbnailHash } from "@/lib/variation-thumbnail-state";
import { createVariationThumbnail, variationThumbnailRenderVersion } from "@/lib/variation-thumbnail";
import { getListingImageSettings } from "@/lib/variation-thumbnail-settings";
import { uploadBufferToR2 } from "@/lib/r2";

export async function ensureVariationThumbnail(
  userId: string,
  group: VariationListingGroup,
) {
  const settings = await getListingImageSettings(userId);
  const hash = createHash("sha256")
    .update(variationThumbnailHash(group))
    .update(variationThumbnailRenderVersion)
    .update(JSON.stringify(settings))
    .digest("hex");
  const existing = await prisma.variationListingState.findUnique({
    where: { userId_groupKey: { userId, groupKey: group.key } },
  });
  if (
    existing?.thumbnailStatus === "READY" &&
    existing.thumbnailHash === hash &&
    existing.thumbnailUrl
  ) {
    return { url: existing.thumbnailUrl, hash, reused: true };
  }

  const baseState = {
    userId,
    groupKey: group.key,
    parentSku: variationParentSku(group.key),
    title: group.title,
  };
  await prisma.variationListingState.upsert({
    where: { userId_groupKey: { userId, groupKey: group.key } },
    create: {
      ...baseState,
      thumbnailStatus: "GENERATING",
      thumbnailHash: hash,
      thumbnailProductIds: group.products.map((product) => product.id),
    },
    update: {
      title: group.title,
      thumbnailStatus: "GENERATING",
      thumbnailHash: hash,
      thumbnailProductIds: group.products.map((product) => product.id),
      thumbnailError: null,
    },
  });

  try {
    let logo: Buffer | null = null;
    if (settings.watermarkEnabled && settings.logoUrl) {
      const response = await fetch(settings.logoUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("저장된 썸네일 로고를 불러오지 못했습니다.");
      logo = Buffer.from(await response.arrayBuffer());
    }
    const imageUrls = group.products.map((product) => product.imageUrl!).filter(Boolean);
    const buffer = await createVariationThumbnail({
      groupName: group.groupName,
      albumName: `${group.albumName} · ${group.versionName}`,
      imageUrls,
      watermarkLogo: logo,
      watermarkOpacity: settings.variationWatermarkOpacity,
      watermarkLogoSize: settings.variationWatermarkLogoSize,
      watermarkGap: settings.variationWatermarkGap,
      imageExposure: settings.imageExposure,
      imageContrast: settings.imageContrast,
      imageSaturation: settings.imageSaturation,
      imageRotation: settings.imageRotation,
      imageZoom: settings.imageZoom,
      imageFlipHorizontal: settings.imageFlipHorizontal,
      backgroundImageUrl: settings.backgroundEnabled ? settings.backgroundUrl : null,
      backgroundEnabled: settings.backgroundEnabled,
      shadowEnabled: settings.shadowEnabled,
      shadowOpacity: settings.shadowOpacity,
      shadowBlur: settings.shadowBlur,
      shadowOffsetX: settings.shadowOffsetX,
      shadowOffsetY: settings.shadowOffsetY,
      backgroundEligible: group.products.filter((product) => Boolean(product.imageUrl)).map((product) => Boolean(product.listingImageIsImageWork)),
      backgroundPadding: settings.backgroundPadding,
      backgroundColor: settings.backgroundColor,
      paddingTop: settings.paddingTop,
      paddingRight: settings.paddingRight,
      paddingBottom: settings.paddingBottom,
      paddingLeft: settings.paddingLeft,
    });
    const uploaded = await uploadBufferToR2({
      buffer,
      key: `products/variation-thumbnails/${hash}.jpg`,
      contentType: "image/jpeg",
    });
    const generatedAt = new Date();
    await prisma.variationListingState.update({
      where: { userId_groupKey: { userId, groupKey: group.key } },
      data: {
        thumbnailStatus: "READY",
        thumbnailUrl: uploaded.url,
        thumbnailKey: uploaded.key,
        thumbnailHash: hash,
        thumbnailProductIds: group.products.map((product) => product.id),
        thumbnailGeneratedAt: generatedAt,
        thumbnailError: null,
      },
    });
    return { url: uploaded.url, hash, reused: false };
  } catch (error) {
    await prisma.variationListingState.update({
      where: { userId_groupKey: { userId, groupKey: group.key } },
      data: {
        thumbnailStatus: "FAILED",
        thumbnailError: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
