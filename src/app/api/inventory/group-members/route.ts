import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { listGroupMembers } from "@/lib/services/photoCardMatchService";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const members = await listGroupMembers(url.searchParams.get("group") ?? "");
    return Response.json({ members });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
