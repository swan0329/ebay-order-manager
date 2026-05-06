import { z } from "zod";
import { syncOrdersForUser } from "@/lib/orders";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const syncSchema = z.object({
  creationDateFrom: z.string().datetime().optional(),
  creationDateTo: z.string().datetime().optional(),
  modifiedDateFrom: z.string().datetime().optional(),
  modifiedDateTo: z.string().datetime().optional(),
  fulfillmentStatus: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "OPEN"])
    .optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = syncSchema.parse(await request.json().catch(() => ({})));
    const result = await syncOrdersForUser(user.id, input);
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("동기화 필터 값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
