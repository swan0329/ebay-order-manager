import { z } from "zod";
import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { createChannelPublishJob, drainChannelPublishJob } from "@/lib/channel-publish-jobs";

export const maxDuration = 300;

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const job = await createChannelPublishJob({
      userId: user.id,
      channel: "EBAY",
      targetIds: input.ids,
    });
    after(() => drainChannelPublishJob(job.id).catch(() => undefined));
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    if (error instanceof z.ZodError) {
      return jsonError("업로드할 draft를 1~50개 선택해 주세요.", 422);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
