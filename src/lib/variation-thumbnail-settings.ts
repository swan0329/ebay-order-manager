import { prisma } from "@/lib/prisma";

export type ListingImageSettings = {
  logoUrl: string | null;
  logoKey: string | null;
  watermarkEnabled: boolean;
  watermarkOpacity: number;
  watermarkLogoSize: number;
  watermarkGap: number;
  variationWatermarkOpacity: number;
  variationWatermarkLogoSize: number;
  variationWatermarkGap: number;
  imageExposure: number;
  imageContrast: number;
  imageSaturation: number;
  imageRotation: number;
  imageZoom: number;
  imageFlipHorizontal: boolean;
  backgroundEnabled: boolean;
  backgroundUrl: string | null;
  backgroundKey: string | null;
  backgroundPadding: number;
  backgroundColor: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  shadowEnabled: boolean;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
};

export const defaultListingImageSettings: ListingImageSettings = {
  logoUrl: null,
  logoKey: null,
  watermarkEnabled: true,
  watermarkOpacity: 0.06,
  watermarkLogoSize: 50,
  watermarkGap: 25,
  variationWatermarkOpacity: 0.06,
  variationWatermarkLogoSize: 50,
  variationWatermarkGap: 25,
  imageExposure: 1,
  imageContrast: 1,
  imageSaturation: 1,
  imageRotation: 0,
  imageZoom: 0,
  imageFlipHorizontal: false,
  backgroundEnabled: false,
  backgroundUrl: null,
  backgroundKey: null,
  backgroundPadding: 80,
  backgroundColor: "#FFFFFF",
  paddingTop: 80,
  paddingRight: 80,
  paddingBottom: 80,
  paddingLeft: 80,
  shadowEnabled: false,
  shadowOpacity: 0.35,
  shadowBlur: 20,
  shadowOffsetX: 12,
  shadowOffsetY: 12,
};

export async function getListingImageSettings(userId: string): Promise<ListingImageSettings> {
  const saved = await prisma.variationThumbnailSetting.findUnique({ where: { userId } });
  return saved ? {
    logoUrl: saved.logoUrl,
    logoKey: saved.logoKey,
    watermarkEnabled: saved.watermarkEnabled,
    watermarkOpacity: saved.watermarkOpacity,
    watermarkLogoSize: saved.watermarkLogoSize,
    watermarkGap: saved.watermarkGap,
    variationWatermarkOpacity: saved.variationWatermarkOpacity,
    variationWatermarkLogoSize: saved.variationWatermarkLogoSize,
    variationWatermarkGap: Math.max(2, Math.min(200, saved.variationWatermarkGap)),
    imageExposure: saved.imageExposure,
    imageContrast: saved.imageContrast,
    imageSaturation: saved.imageSaturation,
    imageRotation: saved.imageRotation,
    imageZoom: saved.imageZoom,
    imageFlipHorizontal: saved.imageFlipHorizontal,
    backgroundEnabled: saved.backgroundEnabled,
    backgroundUrl: saved.backgroundUrl,
    backgroundKey: saved.backgroundKey,
    backgroundPadding: saved.backgroundPadding,
    backgroundColor: saved.backgroundColor,
    paddingTop: saved.paddingTop,
    paddingRight: saved.paddingRight,
    paddingBottom: saved.paddingBottom,
    paddingLeft: saved.paddingLeft,
    shadowEnabled: saved.shadowEnabled,
    shadowOpacity: saved.shadowOpacity,
    shadowBlur: saved.shadowBlur,
    shadowOffsetX: saved.shadowOffsetX,
    shadowOffsetY: saved.shadowOffsetY,
  } : defaultListingImageSettings;
}

export async function saveListingImageSettings(
  userId: string,
  settings: Omit<ListingImageSettings, "logoUrl" | "logoKey" | "backgroundUrl" | "backgroundKey">,
) {
  return prisma.variationThumbnailSetting.upsert({
    where: { userId },
    create: { userId, ...settings },
    update: settings,
  });
}

export async function getVariationThumbnailLogo(userId: string) {
  const settings = await getListingImageSettings(userId);
  return { logoUrl: settings.logoUrl, logoKey: settings.logoKey };
}

export async function saveVariationThumbnailLogo(userId: string, logoUrl: string, logoKey: string) {
  await prisma.variationThumbnailSetting.upsert({
    where: { userId },
    create: { userId, logoUrl, logoKey },
    update: { logoUrl, logoKey },
  });
}

export async function saveListingBackground(userId: string, backgroundUrl: string, backgroundKey: string) {
  await prisma.variationThumbnailSetting.upsert({
    where: { userId },
    create: { userId, backgroundUrl, backgroundKey, backgroundEnabled: true },
    update: { backgroundUrl, backgroundKey, backgroundEnabled: true },
  });
}
