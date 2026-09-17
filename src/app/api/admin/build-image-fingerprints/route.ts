import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  rebuildProductImageFingerprints,
  resetProductImageFingerprintFailures,
} from "@/lib/services/productImageMatchService";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const url = new URL(request.url);
    if (url.searchParams.get("resetFailed") === "1") {
      const reset = await resetProductImageFingerprintFailures();
      return Response.json({ reset });
    }

    const limit = Math.max(1, Math.min(24, Number(url.searchParams.get("limit")) || 12));
    const result = await rebuildProductImageFingerprints(limit, {
      concurrency: 4,
      timeBudgetMs: 20_000,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
