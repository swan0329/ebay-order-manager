import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { shipOrders } from "@/lib/orders";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const shipmentSchema = z.object({
  shipments: z.array(
    z.object({
      orderId: z.string().min(1),
      carrierCode: z.string().min(1),
      trackingNumber: z.string().min(1),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = shipmentSchema.parse(await request.json());
    const results = await shipOrders(user.id, input.shipments);

    return Response.json({
      ok: results.every((result) => result.ok),
      results,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("배송처리 입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
