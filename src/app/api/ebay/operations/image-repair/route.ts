import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getEbayVariationImageRepairJobs, processEbayVariationImageRepairJobs } from "@/lib/services/ebayVariationImageRepair";

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await getEbayVariationImageRepairJobs(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    if (new URL(request.url).searchParams.get("wait") === "1") {
      return Response.json(await processEbayVariationImageRepairJobs(user.id, 20));
    }
    after(() => processEbayVariationImageRepairJobs(user.id));
    return Response.json({ accepted: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
