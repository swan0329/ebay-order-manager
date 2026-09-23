import { jsonError } from "@/lib/http";
import {
  listEbayReportSyncUsers,
  syncEbayActiveReport,
} from "@/lib/ebay-active-report-sync";
import { recoverIncompleteEbayFeedJobs } from "@/lib/ebay-feed-operations";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "eBay 자동 보고서 갱신 실패";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonError("Unauthorized", 401);
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  const userIds = await listEbayReportSyncUsers();
  const results = [];
  for (const userId of userIds) {
    try {
      const recoveredFeedJobs = await recoverIncompleteEbayFeedJobs(userId);
      const result = await syncEbayActiveReport(userId);
      results.push({ userId, ok: true, status: result.status, recoveredFeedJobs });
    } catch (error) {
      results.push({ userId, ok: false, error: errorMessage(error) });
    }
  }
  return Response.json({ ok: results.every((result) => result.ok), results });
}
