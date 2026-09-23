import { jsonError } from "@/lib/http";
import {
  ebayDeletionChallengeResponse,
  ebayDeletionEndpointFromRequest,
  ebayDeletionVerificationTokenPattern,
  trimEbayDeletionEndpoint,
} from "@/lib/ebay-deletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verificationToken() {
  return process.env.EBAY_DELETION_VERIFICATION_TOKEN?.trim() ?? "";
}

function endpointUrl(request: Request) {
  const configuredEndpoint = process.env.EBAY_DELETION_ENDPOINT_URL?.trim();
  return configuredEndpoint
    ? trimEbayDeletionEndpoint(configuredEndpoint)
    : ebayDeletionEndpointFromRequest(request);
}

function logDeletionValidation(
  level: "info" | "warn" | "error",
  message: string,
  data: Record<string, unknown>,
) {
  console[level](
    JSON.stringify({
      event: "ebay.marketplace_account_deletion.validation",
      message,
      ...data,
    }),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");
  const token = verificationToken();
  const endpoint = endpointUrl(request);

  logDeletionValidation("info", "challenge request received", {
    method: request.method,
    requestUrl: ebayDeletionEndpointFromRequest(request),
    configuredEndpointPresent: Boolean(
      process.env.EBAY_DELETION_ENDPOINT_URL?.trim(),
    ),
    effectiveEndpoint: endpoint,
    challengeCodePresent: Boolean(challengeCode),
    challengeCodeLength: challengeCode?.length ?? 0,
    verificationTokenPresent: Boolean(token),
    verificationTokenLength: token.length,
    verificationTokenFormatValid: ebayDeletionVerificationTokenPattern.test(token),
  });

  if (!challengeCode) {
    logDeletionValidation("warn", "challenge_code missing", {
      effectiveEndpoint: endpoint,
    });
    return jsonError("challenge_code is required.", 400);
  }

  if (!token) {
    logDeletionValidation("error", "verification token missing", {
      effectiveEndpoint: endpoint,
    });
    return jsonError("EBAY_DELETION_VERIFICATION_TOKEN is required.", 500);
  }

  if (!ebayDeletionVerificationTokenPattern.test(token)) {
    logDeletionValidation("error", "verification token format invalid", {
      effectiveEndpoint: endpoint,
      verificationTokenLength: token.length,
    });
    return jsonError(
      "EBAY_DELETION_VERIFICATION_TOKEN must be 32-80 characters and contain only letters, numbers, underscores, or hyphens.",
      500,
    );
  }

  const challengeResponse = ebayDeletionChallengeResponse({
    challengeCode,
    verificationToken: token,
    endpoint,
  });

  logDeletionValidation("info", "challenge response generated", {
    effectiveEndpoint: endpoint,
    challengeResponseLength: challengeResponse.length,
  });

  return Response.json({ challengeResponse }, { status: 200 });
}

export async function POST(request: Request) {
  logDeletionValidation("info", "notification acknowledgement sent", {
    method: request.method,
    requestUrl: ebayDeletionEndpointFromRequest(request),
    contentType: request.headers.get("content-type"),
    signaturePresent: Boolean(request.headers.get("x-ebay-signature")),
  });

  return Response.json({ ok: true }, { status: 200 });
}
