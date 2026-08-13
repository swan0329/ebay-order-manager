import { after } from "next/server";
import { GET as runPocamarketCron } from "../../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ hour: string }> },
) {
  const { hour } = await context.params;
  const numericHour = Number(hour);
  if (!Number.isInteger(numericHour) || numericHour < 0 || numericHour > 23) {
    return Response.json({ error: "Invalid scheduled hour." }, { status: 400 });
  }

  const url = new URL("/api/cron/pocamarket-sync", request.url);
  url.searchParams.set("scheduledHour", String(numericHour));
  const recoveryUrl = new URL("/api/cron/ai-image-work", request.url);
  after(() =>
    fetch(recoveryUrl, { headers: request.headers }).catch((error) =>
      console.error("AI image batch watchdog failed.", error),
    ),
  );
  return runPocamarketCron(new Request(url, { headers: request.headers }));
}
