import { prisma } from "@/lib/prisma";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    const movements = await prisma.inventoryMovement.findMany({
      where: productId ? { productId } : {},
      include: { product: true, relatedOrder: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return Response.json({ movements });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
