import { z } from "zod";
import { unlinkEbayActiveListing } from "@/lib/ebay-active-report";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 잘못 연결한 짝을 찾아 보여주고(GET) 풀어준다(DELETE).
// 연결된 항목은 "연결 대기" 목록에서 빠지므로 이 경로로만 손이 닿는다.

const lookupSchema = z.object({
  // SKU 또는 eBay 상품번호. 사람이 아는 값으로 찾게 한다.
  q: z.string().trim().min(1).max(120),
});

const unlinkSchema = z.object({
  listingId: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { q } = lookupSchema.parse({
      q: new URL(request.url).searchParams.get("q") ?? "",
    });

    const listings = await prisma.ebayActiveListing.findMany({
      where: {
        reportImport: { userId: user.id },
        productId: { not: null },
        OR: [{ itemId: q }, { product: { sku: { equals: q, mode: "insensitive" } } }],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        itemId: true,
        title: true,
        imageUrl: true,
        matchStatus: true,
        product: {
          select: {
            id: true,
            sku: true,
            productName: true,
            brand: true,
            optionName: true,
            imageUrl: true,
            ebayItemId: true,
          },
        },
      },
    });

    return Response.json({
      links: listings.map((listing) => ({
        listingId: listing.id,
        itemId: listing.itemId,
        listingTitle: listing.title,
        listingImageUrl: listing.imageUrl,
        matchStatus: listing.matchStatus,
        product: listing.product,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("SKU 또는 상품번호를 입력해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const { listingId } = unlinkSchema.parse(await request.json());

    const result = await unlinkEbayActiveListing(user.id, listingId);
    if (!result) {
      return jsonError("연결된 항목을 찾을 수 없습니다.", 404);
    }

    return Response.json({ ok: true, listingId: result.id });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("해제할 항목을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
