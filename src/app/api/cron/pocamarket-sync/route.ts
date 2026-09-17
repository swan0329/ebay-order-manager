import { jsonError } from "@/lib/http";
import { after } from "next/server";
import {
  ensureScheduledPocamarketSync,
  processPocamarketSyncBatch,
} from "@/lib/pocamarket-sync";
import { prisma } from "@/lib/prisma";
import { ensureProcurementRefreshQueue } from "@/lib/procurement-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return jsonError("Unauthorized", 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  const requestedBatchId = new URL(request.url).searchParams.get("batchId");
  const scheduledHourValue = new URL(request.url).searchParams.get("scheduledHour");
  const scheduledHour =
    scheduledHourValue !== null ? Number(scheduledHourValue) : undefined;
  const resumeOnly = new URL(request.url).searchParams.get("resumeOnly") === "1";
  if (resumeOnly && !requestedBatchId) await ensureProcurementRefreshQueue();
  const scheduled = requestedBatchId || resumeOnly
    ? null
    : await ensureScheduledPocamarketSync(
        Number.isInteger(scheduledHour) ? scheduledHour : undefined,
      );
  const batch = requestedBatchId
    ? await prisma.pocamarketSyncBatch.findFirst({
        where: {
          id: requestedBatchId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      })
    : await prisma.pocamarketSyncBatch.findFirst({
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

  if (batch) {
    after(async () => {
      try {
      const startedAt = Date.now();
      const result = await processPocamarketSyncBatch(batch.id, 100, { startBudgetMs: 240_000 });
      console.info(JSON.stringify({
        event: "pocamarket.sync.cron_chunk",
        batchId: batch.id,
        processed: result.processed,
        status: result.status,
        alreadyRunning: result.alreadyRunning ?? false,
        shouldContinue: result.shouldContinue ?? false,
        elapsedMs: Date.now() - startedAt,
      }));
      } catch { console.error("Pocamarket worker will resume on schedule"); }
    });
  }

  return Response.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    scheduled,
    batchId: batch?.id ?? null,
    queued: Boolean(batch),
  });
}
