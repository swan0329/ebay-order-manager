import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { createDraftsFromInventory } from "@/lib/services/listingDraftService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  productIds: z.array(z.string().min(1)).min(1),
  templateId: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const drafts = await createDraftsFromInventory({
      userId: user.id,
      productIds: input.productIds,
      templateId: input.templateId,
    });

    return Response.json({ drafts, created: drafts.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("선택한 재고 상품을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
