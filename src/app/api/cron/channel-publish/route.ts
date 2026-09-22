import { jsonError } from "@/lib/http";
import { drainChannelPublishJob } from "@/lib/channel-publish-jobs";
import { WAITING_STATUS } from "@/lib/channel-publish-constants";
import { prisma } from "@/lib/prisma";
import { maintainProcurementChannels } from "@/lib/procurement-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonError("Unauthorized", 401);
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  // Separate channel failures: source/stock protection must not stop an already
  // queued image or registration worker from progressing.
  if (new Date().getUTCMinutes() % 5 === 0) {
    try { await maintainProcurementChannels(); }
    catch { console.error("procurement.channel_maintenance_failed: retry on next interval"); }
  }
  const jobId = new URL(request.url).searchParams.get("jobId") ?? (await prisma.channelPublishJob.findFirst({
    where: {
      // 대기 중인 작업도 집어야 앞 작업이 비정상 종료해도 줄이 이어진다.
      status: { in: ["QUEUED", "RUNNING", WAITING_STATUS] },
      OR: [{ workerLeaseExpiresAt: null }, { workerLeaseExpiresAt: { lt: new Date() } }],
    },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
  }))?.id;
  if (!jobId) return Response.json({ ok: true, idle: true });
  const result = await drainChannelPublishJob(jobId);
  return Response.json({ ok: true, job: result.job, queued: result.shouldContinue });
}
