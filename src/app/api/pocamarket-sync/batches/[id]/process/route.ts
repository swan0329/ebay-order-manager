import { jsonError } from "@/lib/http";
import { processPocamarketSyncBatch } from "@/lib/pocamarket-sync";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const ownedBatch = await prisma.pocamarketSyncBatch.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!ownedBatch) return jsonError("작업을 찾을 수 없습니다.", 404);
    const startedAt = Date.now();
    const result = await processPocamarketSyncBatch(id, 100, { startBudgetMs: 240_000 });
    console.info(JSON.stringify({
      event: "pocamarket.sync.chunk",
      batchId: id,
      processed: result.processed,
      status: result.status,
      alreadyRunning: result.alreadyRunning ?? false,
      shouldContinue: result.shouldContinue ?? false,
      elapsedMs: Date.now() - startedAt,
    }));
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "포카마켓 최신화를 처리하지 못했습니다.",
      500,
    );
  }
}
