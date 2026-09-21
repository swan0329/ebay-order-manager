import { jsonError } from "@/lib/http";
import { listEbayReportSyncUsers } from "@/lib/ebay-active-report-sync";
import { syncInsertionFeeSetting } from "@/lib/pricing-insertion-fee-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 가격 계산의 등록수수료를 eBay 정산 기준으로 하루 한 번 맞춘다. 가격을 채널에
 * 내보내지는 않는다. 반영은 사람이 변동처리를 실행할 때만 일어난다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonError("Unauthorized", 401);
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  const results = [];
  for (const userId of await listEbayReportSyncUsers()) {
    try {
      results.push({ userId, ...(await syncInsertionFeeSetting(userId)) });
    } catch (error) {
      results.push({
        userId,
        ok: false,
        error: error instanceof Error ? error.message : "등록수수료 동기화 실패",
      });
    }
  }
  return Response.json({ ok: results.every((result) => result.ok), results });
}
