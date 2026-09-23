import { after } from "next/server";
import { continueCatalogScan } from "@/lib/pocamarket-catalog";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  after(() => continueCatalogScan());
  return Response.json({ queued: true });
}
