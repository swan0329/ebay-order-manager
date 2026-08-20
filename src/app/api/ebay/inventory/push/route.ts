import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";

// 기존 리스팅의 가격과 수량만 바꾼다. 새 리스팅을 만들지 않는다.
const schema = z.object({
  productIds: z.array(z.string().min(1)).max(200).optional(),
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse((await request.json().catch(() => ({}))) ?? {});
    return Response.json(await pushEbayInventory({ userId: user.id, ...input }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
