import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  issueShopifyDuplicateBatchToken,
  verifyShopifyDuplicateBatchToken,
} from "@/lib/services/shopifyRelinkPreview";
import {
  previewShopifyDuplicateBatch,
  repairShopifyDuplicateBatch,
} from "@/lib/services/shopifyVariationRelink";

const mappingSchema = z.object({
  currentShopifyProductId: z.string().regex(/^\d+$/),
  targetShopifyProductId: z.string().regex(/^\d+$/),
});
const inputSchema = z.object({
  mappings: z.array(mappingSchema).min(1).max(10),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().default(false),
  previewToken: z.string().optional(),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = inputSchema.parse(await request.json());
    if (input.dryRun) {
      return Response.json({
        dryRun: true,
        plans: await previewShopifyDuplicateBatch(input.mappings),
        previewToken: issueShopifyDuplicateBatchToken(input.mappings),
      });
    }
    if (!input.confirmed || !input.previewToken || !verifyShopifyDuplicateBatchToken(input.previewToken, input.mappings)) {
      return jsonError("유효한 전체 미리보기와 최종 확인이 필요합니다.", 409);
    }
    return Response.json({ repaired: true, ...(await repairShopifyDuplicateBatch(input.mappings, user.id)) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("Shopify 중복상품 일괄 복구 입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
