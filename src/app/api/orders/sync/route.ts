import { z } from "zod";
import { EbayApiError } from "@/lib/ebay";
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

    if (error instanceof EbayApiError) {
      const body = error.body;
      const detail =
        body && typeof body === "object" && !Array.isArray(body)
          ? [
              (body as Record<string, unknown>).error,
              (body as Record<string, unknown>).error_description,
              (body as Record<string, unknown>).message,
            ]
              .filter((value): value is string => typeof value === "string")
              .join(": ")
          : undefined;

      return jsonError(
        `eBay 주문 API 오류 (${error.status})${detail ? `: ${detail}` : ""}`,
        502,
        { status: error.status, body: error.body },
      );
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
