import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import {
  EbayListingLinkError,
  linkEbayActiveListing,
} from "@/lib/ebay-active-report";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// eBay에만 올라가 있고 프로그램에는 없는 카드를, 리스팅 정보로 상품을 만들면서
// 곧바로 연결한다. 연결까지 해야 그 리스팅의 주문이 상품을 찾아 재고가 차감된다.
// eBay에는 아무것도 쓰지 않는다.
const schema = z.object({
  listingId: z.string().min(1),
  sku: z.string().trim().min(1, "SKU를 입력해 주세요.").max(120),
  // 비워두면 리스팅 제목을 그대로 상품명으로 쓴다.
  productName: z.string().trim().max(240).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());

    const listing = await prisma.ebayActiveListing.findFirst({
      where: { id: input.listingId, reportImport: { userId: user.id } },
      select: {
        id: true,
        itemId: true,
        title: true,
        imageUrl: true,
        price: true,
        quantity: true,
        productId: true,
      },
    });
    if (!listing) {
      return jsonError("리스팅을 찾을 수 없습니다.", 404);
    }
    if (listing.productId) {
      return jsonError("이 리스팅은 이미 상품에 연결되어 있습니다.", 409);
    }

    const productName = input.productName?.trim() || listing.title?.trim();
    if (!productName) {
      return jsonError("리스팅에 제목이 없어 상품명을 직접 입력해 주세요.", 422);
    }

    // eBay에 이미 올라가 있는 재고이므로 리스팅 수량을 그대로 가져온다.
    const stockQuantity = Math.max(0, listing.quantity ?? 0);
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku: input.sku,
          productName,
          stockQuantity,
          // 현재 eBay 판매가를 그대로 둔다. 포카마켓 가격이 붙으면 계산가가 우선한다.
          ebayPrice: listing.price ?? null,
          imageUrl: listing.imageUrl,
          // 그룹·멤버·앨범은 제목만으로 확정할 수 없어 비워둔다. 사람이 채운다.
          status: "active",
        },
        select: { id: true, sku: true },
      });

      // 재고를 0이 아닌 값으로 시작하므로 그 근거를 이력에 남긴다
      // (docs/business-rules.md: 모든 재고 변경은 이력으로 남긴다).
      if (stockQuantity > 0) {
        await tx.inventoryMovement.create({
          data: {
            productId: created.id,
            type: "IN",
            quantity: stockQuantity,
            beforeQuantity: 0,
            afterQuantity: stockQuantity,
            reason: `eBay 리스팅 ${listing.itemId}로 상품 생성`,
            createdBy: user.id,
          },
        });
      }

      return created;
    });

    try {
      await linkEbayActiveListing(user.id, {
        productId: product.id,
        itemId: listing.itemId,
      });
    } catch (error) {
      // 연결에 실패하면 방금 만든 상품만 남아 목록을 어지럽힌다. 되돌린다.
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      throw error;
    }

    return Response.json({ ok: true, productId: product.id, sku: product.sku });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("상품 정보를 확인해 주세요.", 422, error.flatten());
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("이미 있는 SKU입니다. 다른 값을 입력해 주세요.", 409);
    }

    if (error instanceof EbayListingLinkError) {
      return jsonError(error.message, 409);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
