import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
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

/**
 * 사람이 eBay 화면에서 "품절 시 리스팅 유지"가 켜진 것을 직접 보고 확인했다고 기록한다.
 *
 * Trading API 일일 호출 한도를 넘기면(오류 518) 우리가 설정을 읽지 못해 수량 변경이
 * 통째로 막힌다. 그때는 사람이 본 것을 믿는 편이 낫다. 기록해 두면 한도가 풀릴 때까지
 * 작업이 진행되고, 하루 뒤 다시 자동으로 확인한다.
 */
export async function POST() {
  try {
    const user = await requireApiUser();
    const account = await getActiveEbayAccount(user.id);
    await prisma.ebayAccount.update({
      where: { id: account.id },
      data: { outOfStockControlAt: new Date() },
    });
    return Response.json({ ok: true, confirmedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
