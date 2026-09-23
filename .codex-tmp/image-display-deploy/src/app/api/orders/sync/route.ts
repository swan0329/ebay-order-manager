import { z } from "zod";
import { EbayApiError } from "@/lib/ebay";
import { syncOrdersForUser, syncShopifyOrdersForUser } from "@/lib/orders";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { ShopifyApiError } from "@/lib/services/shopifyService";

// 전체 주문을 한 번에 가져올 때 페이지네이션 + 이미지 보강으로 시간이 걸릴 수 있어
// 함수 실행 시간을 넉넉히 잡는다. (플랜 한도에 맞춰 Vercel이 자동으로 클램프함)
export const maxDuration = 300;

const syncSchema = z.object({
  channel: z.enum(["EBAY", "SHOPIFY"]).default("EBAY"),
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
    const { channel, ...filters } = input;
    const result =
      channel === "SHOPIFY"
        ? await syncShopifyOrdersForUser(user.id, filters)
        : await syncOrdersForUser(user.id, filters);
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

    if (error instanceof ShopifyApiError) {
      return jsonError(
        error.status === 401 || error.status === 403
          ? "Shopify 주문 읽기 권한(read_orders)을 확인하고 Admin API 토큰을 다시 설정해 주세요."
          : error.message,
        error.status === 504 ? 504 : 502,
      );
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
