import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { listPhotoCardCandidates } from "@/lib/services/photoCardMatchService";

export async function GET(request: Request) {
  try {
    await requireApiUser();

    const url = new URL(request.url);
    const result = await listPhotoCardCandidates({
      group: url.searchParams.get("group"),
      member: url.searchParams.get("member"),
      album: url.searchParams.get("album"),
      version: url.searchParams.get("version"),
      keyword: url.searchParams.get("keyword"),
      includeRegistered: url.searchParams.get("includeRegistered") === "1",
      limit: Number(url.searchParams.get("limit") || "50"),
      offset: Number(url.searchParams.get("offset") || "0"),
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
