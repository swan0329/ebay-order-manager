import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getEbayInventoryJobSummary, processEbayInventoryJobs } from "@/lib/services/ebayInventoryJobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    // 상태 조회는 읽기 전용이다. 3~5초 폴링마다 새 처리기를 띄우면 연결 제한 1인
    // 운영 DB에 불필요한 경쟁이 생기므로 재개는 POST와 30분 cron에서만 수행한다.
    return Response.json(await getEbayInventoryJobSummary(user.id));
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
