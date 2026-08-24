import { prisma } from "@/lib/prisma";

export type ListingWatermarkSettings = {
  logoUrl: string | null;
  logoKey: string | null;
  watermarkText: string | null;
  watermarkOpacity: number;
  watermarkLogoSize: number;
  watermarkGap: number;
  applyToIndividualCards: boolean;
};

const defaults: ListingWatermarkSettings = {
  logoUrl: null,
  logoKey: null,
  watermarkText: null,
  watermarkOpacity: 0.06,
  watermarkLogoSize: 50,
  watermarkGap: 25,
  applyToIndividualCards: true,
};

export async function getListingWatermarkSettings(userId: string): Promise<ListingWatermarkSettings> {
  return await prisma.variationThumbnailSetting.findUnique({
    where: { userId },
    select: {
      logoUrl: true, logoKey: true, watermarkText: true, watermarkOpacity: true,
      watermarkLogoSize: true, watermarkGap: true, applyToIndividualCards: true,
    },
  }) ?? defaults;
}

/** @deprecated Use getListingWatermarkSettings so automatic jobs receive all controls. */
export async function getVariationThumbnailLogo(userId: string) {
  return getListingWatermarkSettings(userId);
}

export async function saveVariationThumbnailLogo(userId:string, logoUrl:string, logoKey:string) {
  await prisma.variationThumbnailSetting.upsert({ where: { userId }, create: { userId, logoUrl, logoKey }, update: { logoUrl, logoKey } });
}

export async function saveListingWatermarkSettings(
  userId: string,
  input: Pick<ListingWatermarkSettings, "watermarkText" | "watermarkOpacity" | "watermarkLogoSize" | "watermarkGap" | "applyToIndividualCards">,
) {
  return prisma.variationThumbnailSetting.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
    select: {
      logoUrl: true, logoKey: true, watermarkText: true, watermarkOpacity: true,
      watermarkLogoSize: true, watermarkGap: true, applyToIndividualCards: true,
    },
  });
}
