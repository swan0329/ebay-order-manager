import { asErrorMessage, jsonError } from "@/lib/http";
import { getCategoryAspects } from "@/lib/services/ebayTaxonomyService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const categoryId = url.searchParams.get("categoryId")?.trim() ?? "";
    const marketplaceId = url.searchParams.get("marketplaceId")?.trim() || "EBAY_US";

    if (!categoryId) {
      return jsonError("categoryId is required.", 422);
    }

    const result = await getCategoryAspects({
      userId: user.id,
      categoryId,
      marketplaceId,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
