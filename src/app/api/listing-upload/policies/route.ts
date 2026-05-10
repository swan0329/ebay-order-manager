import { asErrorMessage, jsonError } from "@/lib/http";
import { getCachedPolicies } from "@/lib/services/ebayAccountService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    const user = await requireApiUser();
    const policies = await getCachedPolicies(user.id);

    return Response.json(policies);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
