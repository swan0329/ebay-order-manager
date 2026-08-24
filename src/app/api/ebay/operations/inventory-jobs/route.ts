import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getEbayInventoryJobSummary, processEbayInventoryJobs } from "@/lib/services/ebayInventoryJobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const summary = await getEbayInventoryJobSummary(user.id);
    // 서버리스 실행이 중단된 작업도 화면을 다시 열면 자동으로 이어진다.
    if (summary.active) after(() => processEbayInventoryJobs(user.id));
    return Response.json(summary);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST() {
  try {
    const user = await requireApiUser();
    after(() => processEbayInventoryJobs(user.id));
    return Response.json({ accepted: true, job: await getEbayInventoryJobSummary(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
