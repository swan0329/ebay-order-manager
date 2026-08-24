import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { issueListingPreviewToken, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";
import { applyEbayUnitOptionRepairs, scanEbayUnitOptionRepairs } from "@/lib/services/ebayUnitOptionRepair";

const repairSchema = z.object({ itemId: z.string().min(1), sku: z.string().min(1), currentName: z.string(), desiredName: z.string().min(1), productId: z.string().min(1), quantitySold: z.number().int().min(0) });
const schema = z.object({ dryRun: z.boolean(), confirmed: z.boolean().default(false), previewToken: z.string().optional(), keys: z.array(z.string()).max(5).optional(), authorizedKeys: z.array(z.string()).max(500).optional(), requested: z.array(repairSchema).max(5).optional() });
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await requireApiUser(); const input = schema.parse(await request.json());
    const rows = input.dryRun ? await scanEbayUnitOptionRepairs(user.id) : [];
    const key = (row: typeof rows[number]) => `${row.itemId}:${row.sku}:${row.desiredName}`;
    if (input.dryRun) { const keys = rows.filter((row) => row.quantitySold === 0).map(key); return Response.json({ rows, previewToken: keys.length ? issueListingPreviewToken(keys) : null }); }
    const keys = input.keys ?? []; const authorizedKeys = input.authorizedKeys ?? [];
    if (!input.confirmed || !input.previewToken || !verifyListingPreviewToken(input.previewToken, authorizedKeys)) return jsonError("현재 eBay 옵션 확인 후 최종 확인이 필요합니다.", 409);
    if (keys.some((item) => !authorizedKeys.includes(item))) return jsonError("점검하지 않은 eBay 옵션이 포함되어 있습니다.", 409);
    const selected = input.requested ?? [];
    if (selected.length !== keys.length || selected.some((row) => !keys.includes(key(row)))) return jsonError("eBay 옵션 작업 내용이 점검 결과와 다릅니다.", 409);
    const results = await applyEbayUnitOptionRepairs(user.id, selected);
    return Response.json({ succeeded: results.filter((row) => !row.error).length, failed: results.filter((row) => row.error).length, results });
  } catch (error) { if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401); if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422); return jsonError(asErrorMessage(error), 500); }
}
