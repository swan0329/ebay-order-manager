import { jsonError } from "@/lib/http";
import {
  ebayDeletionChallengeResponse,
  ebayDeletionEndpointFromRequest,
} from "@/lib/ebay-deletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verificationToken() {
  return process.env.EBAY_DELETION_VERIFICATION_TOKEN?.trim() ?? "";
}

function endpointUrl(request: Request) {
  return (
    process.env.EBAY_DELETION_ENDPOINT_URL?.trim() ??
    ebayDeletionEndpointFromRequest(request)
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");
  const token = verificationToken();

  if (!challengeCode) {
    return jsonError("challenge_code is required.", 400);
  }

  if (!token) {
    return jsonError("EBAY_DELETION_VERIFICATION_TOKEN is required.", 500);
  }

  return Response.json(
    {
      challengeResponse: ebayDeletionChallengeResponse({
        challengeCode,
        verificationToken: token,
        endpoint: endpointUrl(request),
      }),
    },
    { status: 200 },
  );
}

export async function POST() {
  return Response.json({ ok: true }, { status: 200 });
}
