import { z } from "zod";
import { retryPurchaseJob } from "@/lib/pocamarket-purchases";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const input = z.object({ confirmedNotPurchased: z.literal(true), version: z.string().min(1).max(40) }).parse(await request.json());
    const { id } = await context.params;
    return Response.json({ job: await retryPurchaseJob(user.id, id, input.version) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("남은 수량을 구매하지 않았다는 확인이 필요합니다.", 422);
    return jsonError(asErrorMessage(error), 409);
  }
}
