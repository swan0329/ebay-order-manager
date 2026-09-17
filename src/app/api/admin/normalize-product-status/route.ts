import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();
    const [legacyResult, stockedSoldOutResult] = await prisma.$transaction([
      prisma.product.updateMany({
        where: { status: "inactive" },
        data: { status: "unlisted" },
      }),
      prisma.product.updateMany({
        where: { status: "sold_out", stockQuantity: { gt: 0 } },
        data: { status: "unlisted" },
      }),
    ]);

    return Response.json({
      updated: legacyResult.count + stockedSoldOutResult.count,
      soldOut: 0,
      reactivated: 0,
      unlisted: legacyResult.count + stockedSoldOutResult.count,
      stockedSoldOut: stockedSoldOutResult.count,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
