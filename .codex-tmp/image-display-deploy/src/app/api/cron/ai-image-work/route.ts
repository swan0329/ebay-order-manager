import { after } from "next/server";
import { jsonError } from "@/lib/http";
import { processAiImageApiBatch } from "@/lib/ai-image-work";
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
  let batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId) {
    const stale = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ai_image_api_batches"
      WHERE "status" IN ('queued','running')
        AND "updated_at"<NOW()-INTERVAL '2 minutes'
      ORDER BY "updated_at" LIMIT 1`;
    batchId = stale[0]?.id ?? null;
    if (!batchId) {
      return Response.json({ ok: true, recovered: false, reason: "no_stale_batch" });
    }
  }
  const nextUrl = new URL("/api/cron/ai-image-work", request.url);
  nextUrl.searchParams.set("batchId", batchId);
  after(async () => {
    const result = await processAiImageApiBatch(batchId);
    console.info(JSON.stringify({
      event: "ai_image.api_batch_chunk",
      batchId,
      processed: result.processed,
      recovered: result.recovered,
      shouldContinue: result.shouldContinue,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
    }));
    if (result.shouldContinue) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(nextUrl, {
            headers: secret ? { authorization: `Bearer ${secret}` } : {},
          });
          if (response.ok) return;
          lastError = new Error(`AI batch continuation HTTP ${response.status}`);
        } catch (error) {
          lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      }
      console.error("AI batch continuation failed; watchdog will recover it.", lastError);
    }
  });
  return Response.json({ ok: true, batchId, queued: true });
}
