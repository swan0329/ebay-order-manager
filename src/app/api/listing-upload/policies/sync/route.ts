import { asErrorMessage, jsonError } from "@/lib/http";
import { EbayApiError } from "@/lib/ebay";
import { syncPolicies } from "@/lib/services/ebayAccountService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json().catch(() => ({}))) as {
      marketplaceId?: string;
    };
    const policies = await syncPolicies(user.id, body.marketplaceId || "EBAY_US");

    return Response.json(policies);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    const message = asErrorMessage(error);

    if (
      message.includes("권한") ||
      message.includes("scope") ||
      message.includes("OAuth")
    ) {
      return jsonError(message, 403, { kind: "oauth_scope" });
    }

    if (error instanceof EbayApiError) {
      return jsonError(message, error.status || 502, {
        kind: "ebay_api",
        status: error.status,
        body: error.body,
      });
    }

    return jsonError(message, 500, { kind: "unknown" });
  }
}
