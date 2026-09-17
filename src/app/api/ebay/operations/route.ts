import { z } from "zod";
import { diagnoseEbayFeedJob, listEbayFeedJobs, refreshEbayFeedJob, submitEbayFeedOperation, verifyEbayFeedJob } from "@/lib/ebay-feed-operations";
import { jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

const submitSchema = z.object({
  operation: z.enum(["revise", "end"]),
  limit: z.number().int().min(1).max(10_000).optional(),
  productIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  retryJobId: z.string().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = submitSchema.parse(await request.json());
    return Response.json({ job: await submitEbayFeedOperation(user.id, input.operation, input.limit, input.retryJobId, input.productIds) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("eBay 작업 요청을 확인해 주세요.", 422);
    return jsonError(error instanceof Error ? error.message : "eBay 자동 작업을 시작하지 못했습니다.", 502);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    if (params.get("history") === "true") {
      const sku = params.get("sku")?.trim();
      if (sku !== undefined && (sku.length < 1 || sku.length > 100)) return jsonError("SKU를 확인해 주세요.", 422);
      return Response.json({ jobs: await listEbayFeedJobs(user.id, sku) });
    }
    const jobId = params.get("jobId");
    if (!jobId) return jsonError("jobId가 필요합니다.", 422);
    if (params.get("diagnose") === "true") return Response.json(await diagnoseEbayFeedJob(user.id, jobId));
    if (params.get("verify") === "true") return Response.json(await verifyEbayFeedJob(user.id, jobId));
    return Response.json({ job: await refreshEbayFeedJob(user.id, jobId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(error instanceof Error ? error.message : "eBay 작업 상태를 확인하지 못했습니다.", 502);
  }
}
