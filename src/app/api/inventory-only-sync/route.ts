import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { syncShopifyInventory } from "@/lib/services/channelInventorySync";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";
import { issueListingPreviewToken, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";
import { getMarketIntegrityAudit } from "@/lib/services/marketIntegrityAudit";

const schema = z.object({
  channel: z.enum(["SHOPIFY", "EBAY"]),
  productIds: z.array(z.string().min(1)).min(1).max(500),
  confirmed: z.boolean().default(false),
  previewToken: z.string().optional(),
});

export const maxDuration = 300;

function tokenIds(channel: "SHOPIFY" | "EBAY", productIds: string[]) {
  return [...new Set(productIds)].map((id) => `${channel}:${id}`);
}

function mismatchIds(audit: Awaited<ReturnType<typeof getMarketIntegrityAudit>>, channel: "SHOPIFY" | "EBAY") {
  if (channel === "SHOPIFY") return [...new Set(audit.shopify.quantityIssues.map((row) => row.internalProductId))];
  return [...new Set([
    ...audit.ebay.quantityIssues.map((row) => row.internalProductId),
    ...audit.ebay.variationAudit.quantityIssues.flatMap((row) => row.issues.map((issue) => issue.internalProductId)),
  ])];
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const productIds = [...new Set(input.productIds)];
    const currentIds = mismatchIds(await getMarketIntegrityAudit(user.id), input.channel);
    const allowed = new Set(currentIds);
    if (productIds.some((id) => !allowed.has(id))) return jsonError("현재 재고 불일치 대상이 아닌 상품이 포함되어 있습니다. 다시 미리보기해 주세요.", 409);
    if (!input.confirmed) {
      return Response.json({
        dryRun: true,
        channel: input.channel,
        planned: productIds.length,
        productIds,
        previewToken: issueListingPreviewToken(tokenIds(input.channel, productIds)),
      });
    }
    if (!input.previewToken || !verifyListingPreviewToken(input.previewToken, tokenIds(input.channel, productIds))) {
      return jsonError("유효한 재고 전용 미리보기 후 최종 확인이 필요합니다.", 409);
    }
    if (input.channel === "SHOPIFY") {
      return Response.json({ channel: input.channel, ...(await syncShopifyInventory({ productIds })) });
    }
    return Response.json({ channel: input.channel, ...(await pushEbayInventory({ userId: user.id, productIds, quantityOnly: true, limit: 500 })) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
