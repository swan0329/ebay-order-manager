import { z } from "zod";
import {
  EbayListingLinkError,
  linkEbayActiveListing,
} from "@/lib/ebay-active-report";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 화면에서 고른 eBay 리스팅을 상품에 연결한다. 사람이 확정하는 연결이며
// eBay에는 아무것도 쓰지 않는다(내부 연결 정보만 갱신).
const schema = z.object({
  productId: z.string().min(1),
  // eBay 화면·보고서의 숫자 상품번호.
  itemId: z.string().regex(/^\d+$/, "상품번호는 숫자여야 합니다."),
  // 상품에 붙어 있던 예전 상품번호를 풀고 이것으로 바꾼다. 화면에서 기존 연결을
  // 보여주고 사람이 확인했을 때만 켜진다.
  replaceExisting: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    // replacedItemId도 함께 돌아가므로 화면이 무엇이 풀렸는지 알릴 수 있다.
    const result = await linkEbayActiveListing(user.id, input);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("연결할 상품과 상품번호를 확인해 주세요.", 422, error.flatten());
    }

    // 이미 연결됨·충돌은 사용자가 고칠 수 있는 상황이므로 그대로 알려준다.
    if (error instanceof EbayListingLinkError) {
      return jsonError(error.message, 409);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
