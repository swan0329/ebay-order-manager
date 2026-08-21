import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { syncShopifyInventory } from "@/lib/services/channelInventorySync";

const schema = z.object({
  productIds: z.array(z.string().min(1)).max(500).optional(),
  // 올리기 전에 무엇이 바뀔지 먼저 볼 수 있게 한다.
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse((await request.json().catch(() => ({}))) ?? {});
    // 실제 Shopify 쓰기는 묶음 옵션·가격·재고를 함께 검토하는 채널 운영 메뉴만
    // 사용한다. 이 예전 경로는 진단/미리보기 용도로만 남긴다.
    if (input.dryRun === false) {
      return jsonError("Shopify 실제 전송은 채널 운영 메뉴에서 미리보기와 최종 확인 후 실행해 주세요.", 409);
    }
    return Response.json(await syncShopifyInventory({ ...input, dryRun: true }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
