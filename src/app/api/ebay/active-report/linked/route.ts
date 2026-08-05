import { z } from "zod";
import { unlinkEbayActiveListing } from "@/lib/ebay-active-report";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 잘못 연결한 짝을 찾아 보여주고(GET) 풀어준다(DELETE).
// 연결된 항목은 "연결 대기" 목록에서 빠지므로 이 경로로만 손이 닿는다.

// 검색어가 없으면 최근에 연결한 것부터 보여준다. 방금 무엇을 연결했는지
// 기억나지 않아도 되짚어 풀 수 있어야 한다.
const lookupSchema = z.object({
  q: z.string().trim().max(120).optional(),
});

const RECENT_LIMIT = 30;

const unlinkSchema = z.object({
  listingId: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { q } = lookupSchema.parse({
      q: new URL(request.url).searchParams.get("q") ?? undefined,
    });
    const term = q?.trim();

    const listings = await prisma.ebayActiveListing.findMany({
      where: {
        reportImport: { userId: user.id },
        productId: { not: null },
        ...(term
          ? {
              OR: [
                { itemId: term },
                { product: { sku: { equals: term, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      // 연결 시각이 있으면 그 순서로, 없는 기존 행은 상품이 마지막으로 바뀐
      // 시각으로 대신 정렬한다(연결하면 상품도 함께 갱신되기 때문).
      orderBy: [
        { linkedAt: { sort: "desc", nulls: "last" } },
        { product: { updatedAt: "desc" } },
      ],
      take: term ? 20 : RECENT_LIMIT,
      select: {
        id: true,
        itemId: true,
        title: true,
        imageUrl: true,
        matchStatus: true,
        linkedAt: true,
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
        linkedAt: listing.linkedAt?.toISOString() ?? null,
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
