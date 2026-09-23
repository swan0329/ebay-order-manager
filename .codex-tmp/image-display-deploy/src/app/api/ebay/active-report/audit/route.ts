import { quarantineUnverifiedEbayLinks } from "@/lib/ebay-active-report";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 내부 연결만 점검·격리한다. eBay 가격·수량·이미지에는 어떤 요청도 보내지 않는다.
export async function POST() {
  try {
    const user = await requireApiUser();
    return Response.json({ result: await quarantineUnverifiedEbayLinks(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
