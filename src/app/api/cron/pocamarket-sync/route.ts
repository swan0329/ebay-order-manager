import { jsonError } from "@/lib/http";
import { after } from "next/server";
import {
  ensureScheduledPocamarketSync,
  processPocamarketSyncBatch,
} from "@/lib/pocamarket-sync";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  const scheduled = requestedBatchId
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
    const nextUrl = new URL("/api/cron/pocamarket-sync", request.url);
    nextUrl.searchParams.set("batchId", batch.id);
    after(async () => {
      const startedAt = Date.now();
      const result = await processPocamarketSyncBatch(batch.id);
      console.info(JSON.stringify({
        event: "pocamarket.sync.cron_chunk",
        batchId: batch.id,
        processed: result.processed,
        status: result.status,
        alreadyRunning: result.alreadyRunning ?? false,
        shouldContinue: result.shouldContinue ?? false,
        elapsedMs: Date.now() - startedAt,
      }));
      if (result.shouldContinue && !result.alreadyRunning) {
        await fetch(nextUrl, {
          headers: secret ? { authorization: `Bearer ${secret}` } : {},
        });
      }
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
