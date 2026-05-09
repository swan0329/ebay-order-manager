import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { applyOrderAutomation } from "@/lib/order-automation";
import { saveManualProductMapping } from "@/lib/product-matching";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const matchSchema = z.object({
  orderItemId: z.string().min(1),
  productId: z.string().min(1).nullable(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = matchSchema.parse(await request.json());
    const orderItem = await prisma.orderItem.findFirst({
      where: {
        id: input.orderItemId,
        order: { id, userId: user.id },
      },
    });

    if (!orderItem) {
      return jsonError("주문 아이템을 찾을 수 없습니다.", 404);
    }

    if (orderItem.stockDeducted) {
      return jsonError("이미 재고 차감된 주문 아이템은 상품 연결을 변경할 수 없습니다.", 409);
    }

    if (input.productId) {
      const product = await prisma.product.findUnique({
        where: { id: input.productId },
        select: { id: true },
      });

      if (!product) {
        return jsonError("상품을 찾을 수 없습니다.", 404);
      }
    }

    const updated = await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: {
        productId: input.productId,
        matchedBy: input.productId ? "manual" : null,
        matchScore: null,
      },
      include: { product: true },
    });

    if (input.productId) {
      await saveManualProductMapping({
        userId: user.id,
        productId: input.productId,
        rawJson: orderItem.rawJson,
        title: orderItem.title,
      });
    }

    await applyOrderAutomation(id);

    return Response.json({ orderItem: updated });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("상품 연결 입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
