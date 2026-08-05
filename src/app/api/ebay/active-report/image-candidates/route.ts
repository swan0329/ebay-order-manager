import { z } from "zod";
import { getEbayListingImageUrl } from "@/lib/ebay";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  computeImageFingerprintFromBuffer,
  findProductImageCandidates,
  maxProductMatchImageBytes,
} from "@/lib/services/productImageMatchService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// eBay 리스팅 사진으로 상품을 찾는다. 포토카드는 제목 표기가 사람마다 달라
// 글자 비교로는 자주 빗나가므로, 사진끼리 비교하는 쪽이 훨씬 정확하다.
// 버튼을 눌렀을 때만 실행한다(목록 전체를 자동으로 돌리면 비용이 커진다).
export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  listingId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { listingId } = schema.parse(await request.json());

    const listing = await prisma.ebayActiveListing.findFirst({
      where: { id: listingId, reportImport: { userId: user.id } },
      select: { id: true, itemId: true, imageUrl: true },
    });
    if (!listing) {
      return jsonError("리스팅을 찾을 수 없습니다.", 404);
    }

    // 사진 주소가 아직 없으면 지금 받아와 저장한다.
    let imageUrl = listing.imageUrl;
    if (!imageUrl) {
      imageUrl = await getEbayListingImageUrl({ legacyItemId: listing.itemId });
      if (imageUrl) {
        await prisma.ebayActiveListing.update({
          where: { id: listing.id },
          data: { imageUrl },
          select: { id: true },
        });
      }
    }
    if (!imageUrl) {
      return jsonError("이 리스팅의 eBay 사진을 가져오지 못했습니다.", 422);
    }

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return jsonError("eBay 사진을 내려받지 못했습니다.", 502);
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (buffer.byteLength > maxProductMatchImageBytes) {
      return jsonError("사진이 너무 커서 비교할 수 없습니다.", 422);
    }

    const fingerprint = await computeImageFingerprintFromBuffer(buffer);
    const candidates = await findProductImageCandidates(fingerprint, { limit: 8 });

    // 이미 다른 상품번호가 붙은 상품은 연결할 수 없으므로 함께 알려준다.
    const linkedById = new Map(
      (
        await prisma.product.findMany({
          where: { id: { in: candidates.map((candidate) => candidate.id) } },
          select: { id: true, ebayItemId: true },
        })
      ).map((product) => [product.id, product.ebayItemId]),
    );

    return Response.json({
      listingImageUrl: imageUrl,
      candidates: candidates.map((candidate) => ({
        productId: candidate.id,
        sku: candidate.sku,
        productName: candidate.productName,
        brand: candidate.brand,
        optionName: candidate.optionName,
        category: candidate.category,
        imageUrl: candidate.imageUrl,
        score: Number(candidate.finalScore.toFixed(3)),
        alreadyLinkedItemId: linkedById.get(candidate.id) ?? null,
        memberMismatch: false,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("사진으로 찾을 리스팅을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
