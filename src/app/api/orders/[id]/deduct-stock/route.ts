import { asErrorMessage, jsonError } from "@/lib/http";
import { deductStockForOrder } from "@/lib/inventory";
import { applyOrderAutomation } from "@/lib/order-automation";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const order = await prisma.order.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!order) {
      return jsonError("주문을 찾을 수 없습니다.", 404);
    }

    const result = await deductStockForOrder(order.id, user.id);
    await applyOrderAutomation(order.id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
