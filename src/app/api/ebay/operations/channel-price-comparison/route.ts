import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getChannelPriceComparison } from "@/lib/services/channelPriceComparison";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiUser();
    const comparison = await getChannelPriceComparison();

    return Response.json({
      checkedAt: new Date().toISOString(),
      ...comparison,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
