import { z } from "zod";
import { getEbayListingImageUrl } from "@/lib/ebay";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 연결 화면에서 eBay 카드 사진을 바로 보여주기 위해 대표 이미지를 받아 저장한다.
// 한 번 저장한 리스팅은 다시 eBay를 부르지 않는다.
export const runtime = "nodejs";
export const maxDuration = 60;

// eBay 호출 한도와 함수 실행 시간을 함께 묶어두기 위한 한 번 요청당 상한.
const MAX_FETCH_PER_REQUEST = 20;

const schema = z.object({
  listingIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { listingIds } = schema.parse(await request.json());

    const listings = await prisma.ebayActiveListing.findMany({
      where: { id: { in: listingIds }, reportImport: { userId: user.id } },
      select: { id: true, itemId: true, imageUrl: true },
    });

    const images: Record<string, string> = {};
    const pending: typeof listings = [];
    for (const listing of listings) {
      if (listing.imageUrl) {
        images[listing.id] = listing.imageUrl;
      } else {
        pending.push(listing);
      }
    }

    const toFetch = pending.slice(0, MAX_FETCH_PER_REQUEST);
    const results = await Promise.all(
      toFetch.map(async (listing) => {
        try {
          const imageUrl = await getEbayListingImageUrl({
            legacyItemId: listing.itemId,
          });
          return { id: listing.id, imageUrl: imageUrl ?? null };
        } catch (error) {
          // 한 건이 실패해도 나머지는 보여준다. 사진 없이도 연결은 가능하다.
          safeLog("warn", "ebay.listing_image.failed", {
            message: error instanceof Error ? error.message : "unknown",
          });
          return { id: listing.id, imageUrl: null };
        }
      }),
    );

    const resolved = results.filter(
      (result): result is { id: string; imageUrl: string } => Boolean(result.imageUrl),
    );
    if (resolved.length) {
      await prisma.$transaction(
        resolved.map((result) =>
          prisma.ebayActiveListing.update({
            where: { id: result.id },
            data: { imageUrl: result.imageUrl },
            select: { id: true },
          }),
        ),
      );
      for (const result of resolved) {
        images[result.id] = result.imageUrl;
      }
    }

    return Response.json({
      images,
      // 남은 건이 있으면 화면이 이어서 요청할 수 있게 알려준다.
      remaining: Math.max(0, pending.length - toFetch.length),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("이미지를 불러올 리스팅을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
