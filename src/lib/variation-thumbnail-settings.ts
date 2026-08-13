import { prisma } from "@/lib/prisma";

export async function getVariationThumbnailLogo(userId: string) {
  return await prisma.variationThumbnailSetting.findUnique({ where: { userId }, select: { logoUrl: true, logoKey: true } }) ?? { logoUrl:null, logoKey:null };
}

export async function saveVariationThumbnailLogo(userId:string, logoUrl:string, logoKey:string) {
  await prisma.variationThumbnailSetting.upsert({ where: { userId }, create: { userId, logoUrl, logoKey }, update: { logoUrl, logoKey } });
}
