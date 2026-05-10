import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { buildListingPayloadPreview } from "@/lib/services/listingService";
import {
  coerceListingUploadInput,
  type ListingUploadDraft,
} from "@/lib/services/listingUploadInput";
import { resolveListingTemplateDefaults } from "@/lib/services/listingTemplateService";
import { upsertProductFromListingInput } from "@/lib/services/inventoryService";
import { processProductUpload } from "@/lib/services/uploadQueue";
import { validateListingUploadInput } from "@/lib/services/listingValidationService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const singleUploadSchema = z
  .object({
    templateId: z.string().optional().nullable(),
    previewOnly: z.boolean().optional(),
    validateOnly: z.boolean().optional(),
    sku: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    descriptionHtml: z.string().optional().nullable(),
    price: z.union([z.string(), z.number()]).optional().nullable(),
    quantity: z.union([z.string(), z.number()]).optional().nullable(),
    imageUrls: z.union([z.string(), z.array(z.string())]).optional().nullable(),
    categoryId: z.string().optional().nullable(),
    condition: z.string().optional().nullable(),
    conditionDescription: z.string().optional().nullable(),
    listingDuration: z.string().optional().nullable(),
    listingFormat: z.string().optional().nullable(),
    shippingProfile: z.string().optional().nullable(),
    returnProfile: z.string().optional().nullable(),
    paymentProfile: z.string().optional().nullable(),
    merchantLocationKey: z.string().optional().nullable(),
    marketplaceId: z.string().optional().nullable(),
    currency: z.string().optional().nullable(),
    shippingService: z.string().optional().nullable(),
    handlingTime: z.union([z.string(), z.number()]).optional().nullable(),
    internationalShippingEnabled: z.union([z.boolean(), z.string()]).optional().nullable(),
    excludedLocations: z.union([z.string(), z.array(z.string())]).optional().nullable(),
    bestOfferEnabled: z.union([z.boolean(), z.string()]).optional().nullable(),
    minimumOfferPrice: z.union([z.string(), z.number()]).optional().nullable(),
    autoAcceptPrice: z.union([z.string(), z.number()]).optional().nullable(),
    privateListing: z.union([z.boolean(), z.string()]).optional().nullable(),
    immediatePayRequired: z.union([z.boolean(), z.string()]).optional().nullable(),
    itemSpecifics: z.unknown().optional().nullable(),
    brand: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    countryOfOrigin: z.string().optional().nullable(),
    customLabel: z.string().optional().nullable(),
  })
  .passthrough();

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const raw = singleUploadSchema.parse(await request.json());
    const { template, defaults } = await resolveListingTemplateDefaults(
      user.id,
      raw.templateId,
    );
    const input = coerceListingUploadInput(raw as ListingUploadDraft, defaults);
    const preview = buildListingPayloadPreview(input);
    const validation = await validateListingUploadInput(input, {
      userId: user.id,
      checkImageUrls: true,
      checkOAuthScope: true,
    });

    if (raw.previewOnly || raw.validateOnly) {
      return Response.json({
        ok: validation.valid,
        template,
        finalInput: input,
        preview,
        validation,
      });
    }

    if (!validation.valid) {
      return jsonError("업로드 전 검증에 실패했습니다.", 422, validation);
    }

    const { product, created } = await upsertProductFromListingInput(input, user.id);
    const upload = await processProductUpload({
      userId: user.id,
      productId: product.id,
      sku: product.sku,
      source: "single",
      templateId: template?.id,
      rawJson: raw,
      finalInput: input,
    });

    return Response.json({ product, created, upload, preview, validation });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("상품 업로드 입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
