import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { endEbayListing } from "@/lib/services/ebayEndListing";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { issueListingPreviewToken, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";
import { getMarketIntegrityAudit } from "@/lib/services/marketIntegrityAudit";

const schema = z.object({ itemId: z.string().regex(/^\d+$/), sku: z.string().min(1), confirmed: z.boolean().default(false), previewToken: z.string().optional() });

export const maxDuration = 300;

function tokenIds(itemId: string, sku: string) { return [`END_DUPLICATE_SINGLE:${itemId}:${sku}`]; }

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const audit = await getMarketIntegrityAudit(user.id);
    const duplicate = audit.ebay.variationAudit.crossListingDuplicateSkus.find((row) =>
      row.sku === input.sku && row.listings.some((listing) => listing.itemId === input.itemId && listing.listingType === "SINGLE"),
    );
    if (!duplicate) return jsonError("현재 실제 중복 단품으로 확인되지 않습니다. 다시 점검해 주세요.", 409);
    if (!input.confirmed) return Response.json({ dryRun: true, itemId: input.itemId, sku: input.sku, previewToken: issueListingPreviewToken(tokenIds(input.itemId, input.sku)) });
    if (!input.previewToken || !verifyListingPreviewToken(input.previewToken, tokenIds(input.itemId, input.sku))) return jsonError("유효한 중복 단품 종료 미리보기 후 최종 확인이 필요합니다.", 409);
    const account = await getActiveEbayInventoryAccount(user.id);
    if (!account) return jsonError("eBay 계정이 연결되어 있지 않습니다.", 409);
    const result = await endEbayListing(account, input.itemId);
    await prisma.product.updateMany({ where: { sku: input.sku, ebayItemId: input.itemId }, data: { ebayItemId: null } });
    return Response.json({ ...result, sku: input.sku, ended: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
