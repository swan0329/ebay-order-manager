import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();
    const result = await prisma.product.updateMany({
      where: {
        stockQuantity: { lte: 0 },
        status: { not: "sold_out" },
      },
      data: { status: "sold_out" },
    });

    return Response.json({ updated: result.count });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
