import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { listingUploadSchema, resolveListingImageUrls } from "@/lib/services/listingUploadInput";
import { upsertProductFromListingInput } from "@/lib/services/inventoryService";
import { processProductUpload } from "@/lib/services/uploadQueue";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const singleUploadSchema = z.object({
  sku: z.string(),
  title: z.string(),
  descriptionHtml: z.string(),
  price: z.union([z.string(), z.number()]),
  quantity: z.union([z.string(), z.number()]),
  imageUrls: z.union([z.string(), z.array(z.string())]),
  categoryId: z.string(),
  condition: z.string().optional(),
  shippingProfile: z.string(),
  returnProfile: z.string(),
  paymentProfile: z.string().optional().nullable(),
  merchantLocationKey: z.string().optional().nullable(),
  marketplaceId: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const raw = singleUploadSchema.parse(await request.json());
    const imageUrls = Array.isArray(raw.imageUrls)
      ? raw.imageUrls
      : resolveListingImageUrls(raw.imageUrls);
    const input = listingUploadSchema.parse({
      ...raw,
      condition: raw.condition || "NEW",
      imageUrls,
    });
    const { product, created } = await upsertProductFromListingInput(input, user.id);
    const upload = await processProductUpload({
      userId: user.id,
      productId: product.id,
      sku: product.sku,
      source: "single",
      rawJson: input,
    });

    return Response.json({ product, created, upload });
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
