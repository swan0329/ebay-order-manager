import { asErrorMessage, jsonError } from "@/lib/http";
import { ebayApiRequest, getActiveEbayMessageAccount } from "@/lib/services/ebayApiService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const account = await getActiveEbayMessageAccount(user.id);
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 25), 1), 50);
    const result = await ebayApiRequest(account, { path: "/commerce/message/v1/conversation", query: { limit } });
    return Response.json(result.body);
  } catch (error) {
    return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 422);
  }
}
