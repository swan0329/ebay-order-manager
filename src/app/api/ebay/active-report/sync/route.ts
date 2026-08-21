import { asErrorMessage, jsonError } from "@/lib/http";
import { requestEbayActiveReport, refreshEbayActiveReportSync } from "@/lib/services/ebayActiveReportSync";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { const user = await requireApiUser(); return Response.json({ sync: await refreshEbayActiveReportSync(user.id) }); }
  catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 500); }
}
export async function POST() {
  try { const user = await requireApiUser(); return Response.json({ sync: await requestEbayActiveReport(user.id) }, { status: 202 }); }
  catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 422); }
}
