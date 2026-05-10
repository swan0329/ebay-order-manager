import { asErrorMessage, jsonError } from "@/lib/http";
import { retryFailedDrafts } from "@/lib/services/ebayListingUploadService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    const user = await requireApiUser();
    const results = await retryFailedDrafts(user.id);

    return Response.json({
      results,
      retried: results.length,
      uploaded: results.filter((result) => "result" in result).length,
      failed: results.filter((result) => "error" in result).length,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
