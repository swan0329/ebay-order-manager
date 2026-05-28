import { asErrorMessage, jsonError } from "@/lib/http";
import { getProductStats } from "@/lib/product-stats";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json(await getProductStats());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
