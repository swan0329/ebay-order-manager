import { after } from "next/server";
import { jsonError } from "@/lib/http";
import { processPocamarketSyncBatch } from "@/lib/pocamarket-sync";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

export async function POST(
  request: Request,
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
    const result = await processPocamarketSyncBatch(id);
    console.info(JSON.stringify({
      event: "pocamarket.sync.chunk",
      batchId: id,
      processed: result.processed,
      status: result.status,
      alreadyRunning: result.alreadyRunning ?? false,
      shouldContinue: result.shouldContinue ?? false,
      elapsedMs: Date.now() - startedAt,
    }));
    if (!result.alreadyRunning && result.shouldContinue) {
      const workerUrl = new URL("/api/cron/pocamarket-sync", request.url);
      workerUrl.searchParams.set("batchId", id);
      after(() =>
        fetch(workerUrl, {
          headers: process.env.CRON_SECRET
            ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
            : {},
        }).catch(console.error),
      );
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "포카마켓 최신화를 처리하지 못했습니다.",
      500,
    );
  }
}
