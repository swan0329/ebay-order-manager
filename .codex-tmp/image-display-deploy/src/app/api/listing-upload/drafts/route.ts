import { asErrorMessage, jsonError } from "@/lib/http";
import { listDrafts } from "@/lib/services/listingDraftService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const drafts = await listDrafts(user.id, url.searchParams.get("status"));
    return Response.json({ drafts });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
