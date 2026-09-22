import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { readEbayOutOfStockPreference } from "@/lib/ebay-out-of-stock";
import { getActiveEbayAccount } from "@/lib/services/ebayApiService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "품절 시 리스팅 유지" 설정을 eBay에서 읽어 그대로 보여 준다. 변동처리가 이 설정을
 * 확인하지 못해 멈출 때 무엇이 문제인지 사람이 직접 볼 수 있어야 한다. 읽기만 한다.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const account = await getActiveEbayAccount(user.id);
    const result = await readEbayOutOfStockPreference(account);
    return Response.json({
      ok: result.ok,
      enabled: result.enabled,
      httpStatus: result.httpStatus,
      ack: result.ack,
      errors: result.errors,
      rawExcerpt: result.rawExcerpt,
      // 권한이 모자라 실패하는 경우가 있어 지금 연결에 허용된 범위를 함께 보여 준다.
      scopes: account.scopes.split(/\s+/).filter(Boolean),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 502);
  }
}
