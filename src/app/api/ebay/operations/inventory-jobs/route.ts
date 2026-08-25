import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getEbayInventoryJobSummary, processEbayInventoryJobs } from "@/lib/services/ebayInventoryJobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const job = await getEbayInventoryJobSummary(user.id);
    // 작업번호를 만든 뒤 결과를 확인하는 호출이 cron(최대 30분)에만 의존하면
    // 화면은 영원히 같은 숫자처럼 보인다. DB lease가 중복 실행을 막으므로 상태
    // 조회가 활성 작업을 안전하게 깨우고, 응답 자체는 즉시 돌려준다.
    if (job.active) after(() => processEbayInventoryJobs(user.id));
    return Response.json(job);
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
