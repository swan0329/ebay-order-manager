import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { prepareProductChannelImages } from "@/lib/listing-source-images";

const schema = z.object({ sku: z.string().trim().min(1).max(100) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const product = await prisma.product.findUnique({
      where: { sku: input.sku },
      select: {
        id: true,
        sku: true,
        imageUrl: true,
        ebayImageUrls: true,
        ebayItemId: true,
        shopifyProductId: true,
      },
    });
    if (!product) return jsonError(`${input.sku}: 상품을 찾을 수 없습니다.`, 404);

    const prepared = await prepareProductChannelImages(user.id, product);
    const imageUrls = prepared.ebayImageUrls;
    if (!imageUrls.length) return jsonError(`${input.sku}: 등록할 이미지가 없습니다.`, 422);

    return Response.json({
      sku: product.sku,
      imageUrls,
      source: "CENTRAL_WATERMARK_ASSET",
      registration: { EBAY: Boolean(product.ebayItemId), SHOPIFY: Boolean(product.shopifyProductId) },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("확인할 SKU를 입력해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
