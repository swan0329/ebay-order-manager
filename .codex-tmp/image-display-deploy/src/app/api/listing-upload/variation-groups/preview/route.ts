import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";
import { createVariationThumbnailBase } from "@/lib/variation-thumbnail";
import { getListingImageSettings } from "@/lib/variation-thumbnail-settings";
import { hasListingPrice } from "@/lib/listing-price";
import { variationWatermarkSettingLimits, watermarkSettingLimits } from "@/lib/watermark-setting-limits";

const previewSettingsSchema = z.object({
  watermarkEnabled: z.boolean().optional(),
  backgroundEnabled: z.boolean().optional(),
  watermarkOpacity: z.number().min(watermarkSettingLimits.opacity.min).max(watermarkSettingLimits.opacity.max).optional(),
  watermarkLogoSize: z.number().int().min(watermarkSettingLimits.logoSize.min).max(watermarkSettingLimits.logoSize.max).optional(),
  watermarkGap: z.number().int().min(watermarkSettingLimits.gap.min).max(watermarkSettingLimits.gap.max).optional(),
  variationWatermarkOpacity: z.number().min(watermarkSettingLimits.opacity.min).max(watermarkSettingLimits.opacity.max).optional(),
  variationWatermarkLogoSize: z.number().int().min(variationWatermarkSettingLimits.logoSize.min).max(variationWatermarkSettingLimits.logoSize.max).optional(),
  variationWatermarkGap: z.number().int().min(variationWatermarkSettingLimits.repeatDistance.min).max(variationWatermarkSettingLimits.repeatDistance.max).optional(),
  imageExposure: z.number().min(0).max(2), imageContrast: z.number().min(0).max(2), imageSaturation: z.number().min(0).max(2),
  imageRotation: z.number().min(-180).max(180), imageZoom: z.number().min(0).max(100), imageFlipHorizontal: z.boolean(),
  backgroundPadding: z.number().int().min(0).max(300), backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  paddingTop: z.number().int().min(-300).max(300), paddingRight: z.number().int().min(-300).max(300),
  paddingBottom: z.number().int().min(-300).max(300), paddingLeft: z.number().int().min(-300).max(300),
});
const schema = z.object({ groupKey: z.string().min(1), settings: previewSettingsSchema.optional() });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const [readyImages, savedSettings] = await Promise.all([
      getVariationListingReadyImages(),
      getListingImageSettings(user.id),
    ]);
    const stored = await prisma.product.findMany({ where: { id: { in: readyImages.map((row) => row.id) } } });
    const imageById = new Map(readyImages.map((row) => [row.id, row]));
    const products = stored.filter(hasListingPrice).map((product) => ({
      ...product,
      imageUrl: imageById.get(product.id)?.listingImageUrl ?? null,
      listingImageIsImageWork: imageById.get(product.id)?.listingImageIsImageWork ?? false,
      ebayImageUrls: [],
    }));
    const group = buildVariationListingGroups(products).groups.find((item) => item.key === input.groupKey);
    if (!group) return jsonError("묶음 후보가 변경되었습니다. 새로고침해 주세요.", 404);
    const settings = { ...savedSettings, ...input.settings };
    const buffer = await createVariationThumbnailBase({
      groupName: group.groupName,
      albumName: [group.albumName, group.versionName].filter(Boolean).join(" · "),
      imageUrls: group.products.map((product) => product.imageUrl!).filter(Boolean),
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
      backgroundEligible: group.products.map((product) => Boolean(product.listingImageIsImageWork)),
      backgroundPadding: settings.backgroundPadding,
      backgroundColor: settings.backgroundColor,
      paddingTop: settings.paddingTop,
      paddingRight: settings.paddingRight,
      paddingBottom: settings.paddingBottom,
      paddingLeft: settings.paddingLeft,
    });
    return Response.json({ dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`, width: 800, height: 1200, productCount: group.products.length, uploaded: false });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("묶음을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
