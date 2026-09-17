import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createListingImagePreview,
  listingWatermarkRenderVersion,
} from "@/lib/ebay-watermarked-images";
import { asErrorMessage, jsonError } from "@/lib/http";
import { resolveApprovedListingSourceImageUrls } from "@/lib/listing-source-images";
import { productImageExtrasById } from "@/lib/product-export-image-extras";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { uploadBufferToR2 } from "@/lib/r2";
import {
  getListingImageSettings,
  saveListingImageSettings,
} from "@/lib/variation-thumbnail-settings";
import { variationWatermarkSettingLimits, watermarkSettingLimits } from "@/lib/watermark-setting-limits";

const settingsSchema = z.object({
  watermarkEnabled: z.boolean(),
  watermarkOpacity: z.number().min(watermarkSettingLimits.opacity.min).max(watermarkSettingLimits.opacity.max),
  watermarkLogoSize: z.number().int().min(watermarkSettingLimits.logoSize.min).max(watermarkSettingLimits.logoSize.max),
  watermarkGap: z.number().int().min(watermarkSettingLimits.gap.min).max(watermarkSettingLimits.gap.max),
  variationWatermarkOpacity: z.number().min(watermarkSettingLimits.opacity.min).max(watermarkSettingLimits.opacity.max).optional(),
  variationWatermarkLogoSize: z.number().int().min(variationWatermarkSettingLimits.logoSize.min).max(variationWatermarkSettingLimits.logoSize.max).optional(),
  variationWatermarkGap: z.number().int().min(variationWatermarkSettingLimits.repeatDistance.min).max(variationWatermarkSettingLimits.repeatDistance.max).optional(),
  imageExposure: z.number().min(0).max(2).optional(),
  imageContrast: z.number().min(0).max(2).optional(),
  imageSaturation: z.number().min(0).max(2).optional(),
  imageRotation: z.number().min(-180).max(180).optional(),
  imageZoom: z.number().min(0).max(100).optional(),
  imageFlipHorizontal: z.boolean().optional(),
  backgroundEnabled: z.boolean().optional(),
  backgroundPadding: z.number().int().min(0).max(300).optional(),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  paddingTop: z.number().int().min(-300).max(300).optional(),
  paddingRight: z.number().int().min(-300).max(300).optional(),
  paddingBottom: z.number().int().min(-300).max(300).optional(),
  paddingLeft: z.number().int().min(-300).max(300).optional(),
});

const sampleFields = { sampleHistoryId: z.string().trim().min(1).max(100).optional() };
const sourcePreviewSchema = z.object({ sku: z.string().trim().min(1).max(100), ...sampleFields });

function isChannelDerivative(url: string) {
  return url.includes("/products/channel-watermarked/") || url.includes("/products/ebay-watermarked/");
}

export async function GET() {
  try {
    const user = await requireApiUser();
    const [settings, imageWorkSamples, photographedSamples] = await Promise.all([
      getListingImageSettings(user.id),
      prisma.$queryRaw<Array<{ sku: string; sampleId: string; sourceUrl: string }>>`
        SELECT p."sku", h."id" AS "sampleId", h."image_url" AS "sourceUrl"
        FROM "product_image_history" h
        JOIN "products" p ON p."id" = h."product_id"
        WHERE h."action" IN ('worker_approved', 'ai_approved', 'lens_saved')
          AND h."image_url" IS NOT NULL
          AND h."image_url" NOT LIKE '%/products/channel-watermarked/%'
          AND h."image_url" NOT LIKE '%/products/ebay-watermarked/%'
        ORDER BY h."created_at" DESC
        LIMIT 30
      `,
      prisma.$queryRaw<Array<{ sku: string; userFrontImageUrl: string | null; imageUrl: string | null; sourceImageUrl: string | null }>>`
        SELECT p."sku", p."user_front_image_url" AS "userFrontImageUrl", p."image_url" AS "imageUrl", p."source_image_url" AS "sourceImageUrl"
        FROM "products" p
        WHERE p."image_source" = 'r2_user_uploaded'
          AND COALESCE(p."user_front_image_url", p."image_url", p."source_image_url") IS NOT NULL
        ORDER BY p."updated_at" DESC
        LIMIT 30
      `,
    ]);
    const sampleItems = {
      imageWork: imageWorkSamples.map((sample) => ({ sku: sample.sku, sampleId: sample.sampleId, sourceUrl: sample.sourceUrl, backgroundEligible: true })),
      photographed: photographedSamples.map((sample) => {
        const sourceUrl = [sample.userFrontImageUrl, sample.imageUrl, sample.sourceImageUrl]
          .find((url): url is string => typeof url === "string" && Boolean(url.trim()) && !isChannelDerivative(url));
        return sourceUrl ? { sku: sample.sku, sampleId: null, sourceUrl, backgroundEligible: false } : null;
      }).filter((sample): sample is { sku: string; sampleId: null; sourceUrl: string; backgroundEligible: false } => Boolean(sample)),
    };
    const sampleSkus = {
      imageWork: sampleItems.imageWork[0]?.sku ?? null,
      photographed: sampleItems.photographed[0]?.sku ?? null,
    };
    const sampleSkuLists = {
      imageWork: sampleItems.imageWork.map((sample) => sample.sku),
      photographed: sampleItems.photographed.map((sample) => sample.sku),
    };
    return Response.json({
      settings,
      sampleSkus,
      sampleSkuLists,
      sampleItems,
      suggestedSku: sampleSkus.imageWork ?? sampleSkus.photographed ?? "",
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const input = settingsSchema.parse(await request.json());
    const current = await getListingImageSettings(user.id);
    await saveListingImageSettings(user.id, { ...current, ...input });
    return Response.json({ settings: await getListingImageSettings(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("워터마크 설정값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const rawInput = await request.json();
    const sourceInput = sourcePreviewSchema.parse(rawInput);
    const product = await prisma.product.findUnique({ where: { sku: sourceInput.sku } });
    if (!product) return jsonError(`${sourceInput.sku}: 상품을 찾을 수 없습니다.`, 404);
    const approvedSample = sourceInput.sampleHistoryId
      ? (await prisma.$queryRaw<Array<{ imageUrl: string }>>`
          SELECT h."image_url" AS "imageUrl"
          FROM "product_image_history" h
          WHERE h."id" = ${sourceInput.sampleHistoryId}
            AND h."product_id" = ${product.id}
            AND h."action" IN ('worker_approved', 'ai_approved', 'lens_saved')
            AND h."image_url" IS NOT NULL
          LIMIT 1
        `)[0]
      : null;
    if (sourceInput.sampleHistoryId && !approvedSample) return jsonError("승인된 이미지가공 샘플을 찾을 수 없습니다.", 404);
    const extras = approvedSample ? {} : (await productImageExtrasById([product.id])).get(product.id) ?? {};
    const sourceRows = approvedSample ? [] : await prisma.$queryRaw<Array<{ imageSource: string | null }>>`
      SELECT "image_source" AS "imageSource" FROM "products" WHERE "id" = ${product.id} LIMIT 1
    `;
    const imageSource = approvedSample ? "lens_workbench" : sourceRows[0]?.imageSource ?? null;
    const sourceUrl = approvedSample?.imageUrl ?? (await resolveApprovedListingSourceImageUrls({ ...product, ...extras, imageSource }))[0];
    if (!sourceUrl) return jsonError(`${sourceInput.sku}: 승인된 원본 이미지가 없습니다.`, 422);
    const backgroundEligible = imageSource === "lens_workbench";
    if (new URL(request.url).searchParams.get("mode") === "source") {
      return Response.json(
        { sourceUrl, backgroundEligible },
        { headers: { "cache-control": "private, no-store, max-age=0" } },
      );
    }
    const input = settingsSchema.parse(rawInput);
    const saved = await getListingImageSettings(user.id);
    const settings = { ...saved, ...input };
    const buffer = await createListingImagePreview(sourceUrl, settings, { backgroundEligible });
    if (new URL(request.url).searchParams.get("mode") === "live") {
      return new Response(new Uint8Array(buffer), {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "private, no-store, max-age=0",
          "x-background-eligible": String(backgroundEligible),
        },
      });
    }
    const previewHash = createHash("sha256")
      .update(listingWatermarkRenderVersion)
      .update(sourceUrl)
      .update(String(backgroundEligible))
      .update(JSON.stringify(settings))
      .digest("hex");
    const uploaded = await uploadBufferToR2({
      buffer,
      key: `products/channel-watermark-previews/${previewHash}.jpg`,
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
    });
    return Response.json({
      imageUrl: uploaded.url,
      sku: product.sku,
      sourceUrl,
      backgroundEligible,
      settings,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("미리보기 SKU와 설정값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
