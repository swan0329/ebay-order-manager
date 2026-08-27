import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  issueShopifyRelinkPreviewToken,
  verifyShopifyRelinkPreviewToken,
} from "@/lib/services/shopifyRelinkPreview";
import {
  previewShopifyVariationRelink,
  relinkShopifyVariationGroup,
} from "@/lib/services/shopifyVariationRelink";

const inputSchema = z.object({
  seedProductId: z.string().min(1),
  targetShopifyProductId: z.string().regex(/^\d+$/),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().default(false),
  previewToken: z.string().optional(),
});

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const input = inputSchema.pick({
      seedProductId: true,
      targetShopifyProductId: true,
    }).parse({
      seedProductId: url.searchParams.get("seedProductId"),
      targetShopifyProductId: url.searchParams.get("targetShopifyProductId"),
    });
    const plan = await previewShopifyVariationRelink(
      input.seedProductId,
      input.targetShopifyProductId,
    );
    return Response.json({
      dryRun: true,
      plan,
      previewToken: issueShopifyRelinkPreviewToken(
        input.seedProductId,
        input.targetShopifyProductId,
      ),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      return jsonError("Shopify 중복상품 연결 입력값을 확인해 주세요.", 422);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = inputSchema.parse(await request.json());
    if (input.dryRun) {
      const plan = await previewShopifyVariationRelink(
        input.seedProductId,
        input.targetShopifyProductId,
      );
      return Response.json({
        dryRun: true,
        plan,
        previewToken: issueShopifyRelinkPreviewToken(
          input.seedProductId,
          input.targetShopifyProductId,
        ),
      });
    }
    if (
      !input.confirmed ||
      !input.previewToken ||
      !verifyShopifyRelinkPreviewToken(
        input.previewToken,
        input.seedProductId,
        input.targetShopifyProductId,
      )
    ) {
      return jsonError(
        "유효한 Shopify 중복상품 연결 미리보기 후 최종 확인이 필요합니다.",
        409,
      );
    }
    const result = await relinkShopifyVariationGroup(
      input.seedProductId,
      input.targetShopifyProductId,
      user.id,
    );
    return Response.json({ relinked: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      return jsonError("Shopify 중복상품 연결 입력값을 확인해 주세요.", 422);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
