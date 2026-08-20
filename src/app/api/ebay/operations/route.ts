import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getEbayOperations } from "@/lib/services/ebayOperations";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";
import { issueListingPreviewToken, previewListingUpload, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";
import { createDraftsFromInventory } from "@/lib/services/listingDraftService";

const executeSchema = z.object({
  action: z.enum(["CREATE", "CHANGE", "UNAVAILABLE"]),
  productIds: z.array(z.string().min(1)).min(1).max(200),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().default(false),
  previewToken: z.string().optional(),
});

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await getEbayOperations(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = executeSchema.parse(await request.json());
    if (input.action === "CREATE") {
      if (!input.dryRun) return jsonError("신규등록 실행은 서명된 신규등록 경로를 사용해 주세요.", 409);
      const current = await getEbayOperations(user.id);
      const allowed = new Set(current.create.flatMap(row => row.productId ? [row.productId] : []));
      const productIds = [...new Set(input.productIds)];
      if (productIds.some(id => !allowed.has(id))) return jsonError("현재 신규등록 대상이 아닌 상품이 포함되어 있습니다.", 409);
      const existing = await prisma.listingDraft.findMany({ where: { userId: user.id, sourceInventoryId: { in: productIds }, status: { in: ["draft", "validated", "failed"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, sourceInventoryId: true } });
      const existingProducts = new Set(existing.flatMap(row => row.sourceInventoryId ? [row.sourceInventoryId] : []));
      const missing = productIds.filter(id => !existingProducts.has(id));
      if (missing.length) await createDraftsFromInventory({ userId: user.id, productIds: missing });
      const drafts = await prisma.listingDraft.findMany({ where: { userId: user.id, sourceInventoryId: { in: productIds }, status: { in: ["draft", "validated", "failed"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, sourceInventoryId: true } });
      const newest = new Map<string,string>(); for (const draft of drafts) if (draft.sourceInventoryId && !newest.has(draft.sourceInventoryId)) newest.set(draft.sourceInventoryId,draft.id);
      const draftIds = productIds.flatMap(id => newest.get(id) ? [newest.get(id)!] : []);
      if (draftIds.length !== productIds.length) return jsonError("일부 상품의 등록 초안을 만들지 못했습니다.", 500);
      const preview = await previewListingUpload(user.id, draftIds);
      return Response.json({ ...preview, dryRun: true, previewToken: preview.valid ? issueListingPreviewToken(draftIds) : null });
    }
    if (!input.dryRun && (!input.confirmed || !input.previewToken || !verifyListingPreviewToken(input.previewToken, input.productIds))) return jsonError("유효한 미리보기 후 최종 확인이 필요합니다.", 409);
    const current = await getEbayOperations(user.id);
    const allowed = new Set((input.action === "CHANGE" ? current.change : current.unavailable).map((row) => row.productId));
    const productIds = [...new Set(input.productIds)].filter((id) => allowed.has(id));
    if (productIds.length !== new Set(input.productIds).size) return jsonError("현재 대상이 아닌 상품이 포함되어 있습니다. 목록을 새로고침해 주세요.", 409);
    const result = await pushEbayInventory({ userId: user.id, productIds, dryRun: input.dryRun, limit: 200 });
    return Response.json(input.dryRun ? { ...result, previewToken: issueListingPreviewToken(productIds) } : result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("선택 항목을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
