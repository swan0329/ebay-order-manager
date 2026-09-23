import { asErrorMessage, jsonError } from "@/lib/http";
import { getProductStats } from "@/lib/product-stats";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const requestedChannel = new URL(request.url).searchParams.get("channel");
    const channel = requestedChannel === "SHOPIFY" ? "SHOPIFY" : "EBAY";
    return Response.json(await getProductStats(channel));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
