import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";
import { issueListingPreviewToken, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";

// 기존 리스팅의 가격과 수량만 바꾼다. 새 리스팅을 만들지 않는다.
const schema = z.object({
  // 이 보조 경로는 선택한 상품만 수정한다. ID가 없으면 서비스가 "전체"로
  // 해석하므로, 빈 선택으로 대량 반영되는 사고를 막기 위해 필수로 둔다.
  productIds: z.array(z.string().min(1)).min(1).max(200),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  previewToken: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse((await request.json().catch(() => ({}))) ?? {});
    const productIds = [...new Set(input.productIds ?? [])];
    if (input.dryRun !== false) {
      const preview = await pushEbayInventory({ userId: user.id, ...input, productIds, dryRun: true });
      return Response.json({ ...preview, previewToken: issueListingPreviewToken(productIds) });
    }
    if (!input.confirmed || !input.previewToken || !verifyListingPreviewToken(input.previewToken, productIds)) {
      return jsonError("유효한 eBay 미리보기 후 최종 확인이 필요합니다.", 409);
    }
    return Response.json(await pushEbayInventory({ userId: user.id, ...input, productIds, dryRun: false }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
