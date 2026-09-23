import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  confirmVariationUploadResult,
  parseEbayUploadResult,
} from "@/lib/variation-upload-confirm";

// eBay가 돌려준 처리 결과 파일로 옵션상품 등록 결과를 확정한다.
// 전체 활성상품 보고서를 다시 받지 않아도 되고, eBay API도 호출하지 않는다.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("eBay 처리 결과 파일이 필요합니다.", 422);
    if (file.size > 15 * 1024 * 1024) {
      return jsonError("결과 파일은 15MB 이하만 사용할 수 있습니다.", 422);
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
      return jsonError("CSV, XLSX 또는 XLS 파일만 사용할 수 있습니다.", 422);
    }

    const rows = parseEbayUploadResult(Buffer.from(await file.arrayBuffer()));
    const result = await confirmVariationUploadResult(user.id, rows);
    return Response.json({ result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 422);
  }
}
