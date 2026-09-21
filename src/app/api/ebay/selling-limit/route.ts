import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getSellingLimit } from "@/lib/ebay-selling-limit";
import { getActiveEbayAccount } from "@/lib/services/ebayApiService";

export const maxDuration = 30;

/**
 * 계정의 판매 한도만 돌려준다. 무료 등록 한도가 아니며 등록수수료와 이어 붙이지 않는다.
 * 읽기만 한다.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const account = await getActiveEbayAccount(user.id);
    const limit = await getSellingLimit(account);
    return Response.json({ ok: true, available: true, ...limit });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    // 못 읽으면 "확인 불가"로 둔다. 다른 값으로 추정하지 않는다.
    return Response.json({ ok: true, available: false, error: asErrorMessage(error) });
  }
}
