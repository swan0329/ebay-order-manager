import { jsonError } from "@/lib/http";
import { pausePocamarketSyncBatch } from "@/lib/pocamarket-sync";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return Response.json(await pausePocamarketSyncBatch(user.id, id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "최신화를 일시정지하지 못했습니다.",
      422,
    );
  }
}
