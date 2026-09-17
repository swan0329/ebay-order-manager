import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { repairEbayVariationContent } from "@/lib/ebay-variation-content";

export const maxDuration = 300;
const schema = z.object({ productId: z.string().min(1), confirmed: z.literal(true), applyTemplatePolicies: z.boolean().default(false) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    return Response.json(await repairEbayVariationContent(user.id, input.productId, input.applyTemplatePolicies));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("수정할 상품과 확인 여부가 필요합니다.", 422);
    return jsonError(error instanceof Error && !error.message.includes("API") ? error.message : "이베이 상세 설명 수정에 실패했습니다.", 422);
  }
}
