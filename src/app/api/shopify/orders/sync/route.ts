import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { syncShopifyOrders } from "@/lib/services/shopifyOrderSync";

const schema = z.object({
  limit: z.number().int().min(1).max(250).optional(),
  // 이 시각 이후에 바뀐 주문만 가져온다. 비우면 최근 주문부터 받는다.
  updatedAfter: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json().catch(() => ({}));
    const input = schema.parse(body ?? {});
    const result = await syncShopifyOrders({
      userId: user.id,
      limit: input.limit,
      updatedAfter: input.updatedAfter ? new Date(input.updatedAfter) : null,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("가져오기 입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
