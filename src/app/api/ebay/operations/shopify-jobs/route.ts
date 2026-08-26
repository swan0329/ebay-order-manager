import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getShopifyOperationJobSummary, processShopifyOperationJobs } from "@/lib/services/shopifyOperationJobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const job = await getShopifyOperationJobSummary(user.id);
    if (job.active) after(() => processShopifyOperationJobs(user.id));
    return Response.json(job);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST() {
  try {
    const user = await requireApiUser();
    after(() => processShopifyOperationJobs(user.id));
    return Response.json({ accepted: true, job: await getShopifyOperationJobSummary(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
