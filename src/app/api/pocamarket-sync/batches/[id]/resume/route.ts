import { jsonError } from "@/lib/http";
import { after } from "next/server";
import { resumePocamarketSyncBatch } from "@/lib/pocamarket-sync";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = (await request.json().catch(() => ({}))) as {
      errorCode?: string;
    };
    const result = await resumePocamarketSyncBatch(
      user.id,
      id,
      input.errorCode?.trim() || undefined,
    );
    const workerUrl = new URL("/api/cron/pocamarket-sync", request.url);
    workerUrl.searchParams.set("batchId", id);
    after(() =>
      fetch(workerUrl, {
        headers: process.env.CRON_SECRET
          ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
          : {},
      }).catch(console.error),
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(error instanceof Error ? error.message : "이어하지 못했습니다.", 422);
  }
}
