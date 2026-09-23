import { after } from "next/server";
import { z } from "zod";
import {
  createShopifyAutomaticOperationJob,
  drainChannelPublishJob,
} from "@/lib/channel-publish-jobs";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 300;

const schema = z.object({
  operation: z.enum(["revise", "end"]),
  limit: z.number().int().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const job = await createShopifyAutomaticOperationJob({
      userId: user.id,
      ...input,
    });
    after(() => drainChannelPublishJob(job.id).catch(() => undefined));
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      return jsonError("Shopify 작업 요청을 확인해 주세요.", 422);
    }
    return jsonError(asErrorMessage(error), 422);
  }
}
