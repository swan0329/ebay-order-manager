import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();
    const [soldOutResult, reactivatedResult] = await prisma.$transaction([
      prisma.product.updateMany({
        where: {
          stockQuantity: { lte: 0 },
          status: { not: "sold_out" },
        },
        data: { status: "sold_out" },
      }),
      prisma.product.updateMany({
        where: {
          stockQuantity: { gt: 0 },
          status: "sold_out",
        },
        data: { status: "active" },
      }),
    ]);

    return Response.json({
      updated: soldOutResult.count + reactivatedResult.count,
      soldOut: soldOutResult.count,
      reactivated: reactivatedResult.count,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
