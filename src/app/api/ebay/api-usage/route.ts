import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { loadEbayApiUsage } from "@/lib/services/ebayApiUsage";

// 현황만 읽는다. 아무것도 바꾸지 않는다.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await loadEbayApiUsage(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
