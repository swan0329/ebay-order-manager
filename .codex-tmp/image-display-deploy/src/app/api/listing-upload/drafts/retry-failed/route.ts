import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { createChannelPublishJob, drainChannelPublishJob } from "@/lib/channel-publish-jobs";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

export async function POST() {
  try {
    const user = await requireApiUser();
    const drafts = await prisma.listingDraft.findMany({
      where: { userId: user.id, status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: { id: true },
    });
    if (!drafts.length) return Response.json({ retried: 0, message: "재시도할 실패가 없습니다." });
    const job = await createChannelPublishJob({
      userId: user.id,
      channel: "EBAY",
      targetIds: drafts.map((draft) => draft.id),
    });
    after(() => drainChannelPublishJob(job.id).catch(() => undefined));
    return Response.json({ retried: drafts.length, job }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
