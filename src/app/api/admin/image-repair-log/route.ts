import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 30;

type Snapshot = {
  urls?: string[];
  parentVerified?: boolean;
  optionVerified?: boolean;
  after?: {
    PictureDetails?: {
      PictureURL?: unknown;
      ExtendedPictureDetails?: unknown;
    };
    ListingType?: string;
  };
};

const list = (value: unknown) =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

// eBay 이미지 변경이 "재조회 확인이 필요합니다"로 끝났을 때, eBay가 실제로 돌려준
// 사진 주소를 본다. 읽기 전용이며 판매 정보는 바꾸지 않는다.
export async function GET() {
  try {
    const user = await requireApiUser();
    const logs = await prisma.syncLog.findMany({
      where: { userId: user.id, type: "EBAY_IMAGE_REPAIR" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, status: true, message: true, createdAt: true, rawJson: true },
    });
    return Response.json({
      ok: true,
      logs: logs.map((log) => {
        const snapshot = (log.rawJson ?? {}) as Snapshot;
        const pictures = snapshot.after?.PictureDetails;
        return {
          createdAt: log.createdAt,
          status: log.status,
          message: log.message,
          listingType: snapshot.after?.ListingType ?? null,
          expectedUrls: snapshot.urls ?? [],
          parentVerified: snapshot.parentVerified ?? null,
          optionVerified: snapshot.optionVerified ?? null,
          ebayPictureUrls: list(pictures?.PictureURL).slice(0, 5),
          ebayExternalUrls: list(pictures?.ExtendedPictureDetails)
            .map((entry) => (entry as { ExternalPictureURL?: string })?.ExternalPictureURL)
            .slice(0, 5),
        };
      }),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "이미지 변경 기록을 읽지 못했습니다.",
      500,
    );
  }
}
