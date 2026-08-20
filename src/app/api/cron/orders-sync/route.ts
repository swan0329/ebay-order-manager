import { jsonError } from "@/lib/http";
import { runScheduledOrderSync } from "@/lib/scheduled-order-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return jsonError("Unauthorized", 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  const result = await runScheduledOrderSync();
  return Response.json(result, { status: result.ok ? 200 : 207 });
}
