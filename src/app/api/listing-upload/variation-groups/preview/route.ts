import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";
import { createVariationThumbnail } from "@/lib/variation-thumbnail";
import { resolveListingWatermark } from "@/lib/listing-watermark";
import { hasListingPrice } from "@/lib/listing-price";

const schema = z.object({ groupKey: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const [readyImages, watermark] = await Promise.all([
      getVariationListingReadyImages(),
      resolveListingWatermark(user.id),
    ]);
    const stored = await prisma.product.findMany({ where: { id: { in: readyImages.map((row) => row.id) } } });
    const imageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
    const products = stored.filter(hasListingPrice).map((product) => ({ ...product, imageUrl: imageById.get(product.id) ?? null, ebayImageUrls: [] }));
    const group = buildVariationListingGroups(products).groups.find((item) => item.key === input.groupKey);
    if (!group) return jsonError("묶음 후보가 변경되었습니다. 새로고침해 주세요.", 404);
    const buffer = await createVariationThumbnail({
      groupName: group.groupName,
      albumName: [group.albumName, group.versionName].filter(Boolean).join(" · "),
      imageUrls: group.products.map((product) => product.imageUrl!).filter(Boolean),
      watermarkLogo: watermark.logo,
      watermarkText: watermark.watermarkText ?? undefined,
      watermarkOpacity: watermark.watermarkOpacity,
      watermarkLogoSize: watermark.watermarkLogoSize,
      watermarkGap: watermark.watermarkGap,
    });
    return Response.json({ dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`, width: 1000, height: 1000, productCount: group.products.length, uploaded: false });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("묶음을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
