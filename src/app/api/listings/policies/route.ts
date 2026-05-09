import { asErrorMessage, jsonError } from "@/lib/http";
import { getSellerListingPolicies } from "@/lib/services/listingPolicyService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const marketplaceId = url.searchParams.get("marketplaceId") || "EBAY_US";
    const policies = await getSellerListingPolicies(user.id, marketplaceId);
    return Response.json(policies);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
