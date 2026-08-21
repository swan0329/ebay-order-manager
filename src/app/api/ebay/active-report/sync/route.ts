import { asErrorMessage, jsonError } from "@/lib/http";
import { requestEbayActiveReport, refreshEbayActiveReportSync } from "@/lib/services/ebayActiveReportSync";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { safeLog } from "@/lib/safe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { const user = await requireApiUser(); return Response.json({ sync: await refreshEbayActiveReportSync(user.id) }); }
  catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 500); }
}
export async function POST() {
  try { const user = await requireApiUser(); const sync = await requestEbayActiveReport(user.id); return Response.json({ sync }, { status: 202 }); }
  catch (error) { safeLog("warn", "ebay.active_report.request_failed", { message: asErrorMessage(error) }); return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 422); }
}
