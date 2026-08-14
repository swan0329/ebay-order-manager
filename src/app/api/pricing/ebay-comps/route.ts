import { z } from "zod";
import { EbayApiError } from "@/lib/ebay";
import { findMarketComps } from "@/lib/ebay-market-comps";
import { asErrorMessage, jsonError } from "@/lib/http";
import { productImageExtrasById } from "@/lib/product-export-image-extras";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// eBay에 올라와 있는 같은 카드의 판매가 후보를 돌려준다. 조회만 하며 상품 가격을
// 바꾸지 않는다. 채택은 화면에서 사람이 고른 뒤 별도 저장 요청으로 이뤄진다.
export const runtime = "nodejs";
// 이미지를 내려받아 eBay로 올리는 왕복이라 기본 제한으로는 빠듯할 수 있다.
export const maxDuration = 30;

const schema = z.object({
  productId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { productId } = schema.parse(await request.json());

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        sku: true,
        brand: true,
        category: true,
        optionName: true,
        productName: true,
        ebayTitle: true,
        imageUrl: true,
        ebayImageUrls: true,
      },
    });
    if (!product) {
      return jsonError("상품을 찾을 수 없습니다.", 404);
    }

    const extras = (await productImageExtrasById([product.id])).get(product.id);
    const result = await findMarketComps(
      {
        ...product,
        userFrontImageUrl: extras?.userFrontImageUrl ?? null,
        featuredMembers: extras?.featuredMembers ?? null,
      },
      user.id,
    );

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("조회할 상품을 확인해 주세요.", 422, error.flatten());
    }

    // eBay 원본 오류를 그대로 노출하지 않는다(docs/standards.md).
    if (error instanceof EbayApiError) {
      return jsonError("eBay 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
