import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { syncShopifyInventory } from "@/lib/services/channelInventorySync";

const schema = z.object({
  productIds: z.array(z.string().min(1)).max(500).optional(),
  // 올리기 전에 무엇이 바뀔지 먼저 볼 수 있게 한다.
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse((await request.json().catch(() => ({}))) ?? {});
    return Response.json(await syncShopifyInventory(input));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
