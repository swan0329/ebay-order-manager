import { getEbayListingImageUrl } from "@/lib/ebay";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };

// 과거 촬영본 필드가 포카마켓 주소로 덮였더라도 eBay에 게시된 실제 사진을
// 다시 가져와 상품의 eBay 이미지 캐시를 복구한다. 이미지 요청 시 한 상품씩
// 실행되므로 목록 전체를 한 번에 외부 호출해 타임아웃시키지 않는다.
export async function GET(_request: Request, context: Context) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: { ebayItemId: true, ebayImageUrls: true },
    });
    if (!product?.ebayItemId) return jsonError("연결된 eBay 상품이 없습니다.", 404);

    let imageUrl: string | null = product.ebayImageUrls[0] ?? null;
    if (!imageUrl) {
      const cached = await prisma.ebayActiveListing.findFirst({
        where: { itemId: product.ebayItemId, imageUrl: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { imageUrl: true },
      });
      imageUrl = cached?.imageUrl ?? null;
    }
    if (!imageUrl) {
      imageUrl = await getEbayListingImageUrl({ legacyItemId: product.ebayItemId });
    }
    if (!imageUrl) return jsonError("eBay 실제 이미지를 가져오지 못했습니다.", 404);

    if (!product.ebayImageUrls.length) {
      await prisma.product.update({
        where: { id },
        data: { ebayImageUrls: [imageUrl] },
        select: { id: true },
      });
    }
    return Response.redirect(imageUrl, 307);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(error instanceof Error ? error.message : "이미지 복구 실패", 500);
  }
}
