import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { rebuildProductImageFingerprints } from "@/lib/services/productImageMatchService";

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100));
    const result = await rebuildProductImageFingerprints(limit);

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
