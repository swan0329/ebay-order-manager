import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { issueListingPreviewToken, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";
import { applyEbayUnitOptionRepairs, scanEbayUnitOptionRepairs } from "@/lib/services/ebayUnitOptionRepair";

const schema = z.object({ dryRun: z.boolean(), confirmed: z.boolean().default(false), previewToken: z.string().optional(), keys: z.array(z.string()).optional() });
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await requireApiUser(); const input = schema.parse(await request.json()); const rows = await scanEbayUnitOptionRepairs(user.id);
    const key = (row: typeof rows[number]) => `${row.itemId}:${row.sku}:${row.desiredName}`;
    if (input.dryRun) { const keys = rows.map(key); return Response.json({ rows, previewToken: issueListingPreviewToken(keys) }); }
    const keys = input.keys ?? [];
    if (!input.confirmed || !input.previewToken || !verifyListingPreviewToken(input.previewToken, keys)) return jsonError("현재 eBay 옵션 확인 후 최종 확인이 필요합니다.", 409);
    const selected = rows.filter((row) => keys.includes(key(row)));
    if (selected.length !== keys.length) return jsonError("eBay 옵션 상태가 바뀌었습니다. 다시 점검해 주세요.", 409);
    const results = await applyEbayUnitOptionRepairs(user.id, selected);
    return Response.json({ succeeded: results.filter((row) => !row.error).length, failed: results.filter((row) => row.error).length, results });
  } catch (error) { if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401); if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422); return jsonError(asErrorMessage(error), 500); }
}
