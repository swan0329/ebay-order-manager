import { after } from "next/server";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import {
  cancelActiveChannelPublishJobs,
  retryEbayImageFailures,
  createChannelPublishJob,
  drainChannelPublishJob,
  getActiveChannelPublishJobs,
  getRecentChannelPublishJobs,
  getChannelPublishJob,
  isChannelPublishTerminal,
} from "@/lib/channel-publish-jobs";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 300;

const createSchema = z.object({
  channel: z.enum(["EBAY", "SHOPIFY"]),
  mode: z.enum(["UPSERT", "PRICE_INVENTORY", "IMAGES", "ARCHIVE"]).optional(),
  targetIds: z.array(z.string().min(1)).min(1).max(500),
});

function startWorker(jobId: string) {
  // Run the queue service inside this authenticated request's invocation.
  // A self-HTTP call used to depend on CRON_SECRET; when that optional setting
  // was absent in production, jobs were accepted but stayed QUEUED forever.
  after(() => drainChannelPublishJob(jobId).catch(() => undefined));
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = createSchema.parse(await request.json());
    const job = await createChannelPublishJob({ ...input, userId: user.id });
    startWorker(job.id);
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      return jsonError("등록 채널과 대상 1~500개를 확인해 주세요.", 422);
    }
    return jsonError(asErrorMessage(error), 422);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId && new URL(request.url).searchParams.get("history") === "true") return Response.json({ jobs: await getRecentChannelPublishJobs(user.id) });
    if (!jobId) return Response.json({ jobs: await getActiveChannelPublishJobs(user.id) });
    const history = new URL(request.url).searchParams.get("history") === "true";
    const job = await getChannelPublishJob(user.id, jobId, history);
    if (!job) return jsonError("등록 작업을 찾을 수 없습니다.", 404);
    if (!history && !isChannelPublishTerminal(job.status)) startWorker(job.id);
    return Response.json({ job });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE() {
  try {
    const user = await requireApiUser();
    return Response.json(await cancelActiveChannelPublishJobs(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const input = z.object({ jobId: z.string().min(1), skus: z.array(z.string().min(1)).min(1).max(500).optional() }).parse(await request.json());
    const result = await retryEbayImageFailures(user.id, input.jobId, input.skus);
    if (result.retried) startWorker(input.jobId);
    return Response.json(result);
  } catch (error) {
    return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 422);
  }
}
