import { asErrorMessage, jsonError } from "@/lib/http";
import { assertR2Configured, testR2Connection } from "@/lib/r2";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    await requireApiUser();
    const config = assertR2Configured();
    const result = await testR2Connection();

    return Response.json({
      ok: true,
      bucketName: result.bucketName,
      publicBaseUrl: result.publicBaseUrl,
      endpoint: result.endpoint,
      accountId: config.accountId,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
