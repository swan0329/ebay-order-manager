import { createHash } from "node:crypto";

export const ebayDeletionVerificationTokenPattern = /^[A-Za-z0-9_-]{32,80}$/;

export function normalizeEbayDeletionEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, "");
}

export function ebayDeletionChallengeResponse(input: {
  challengeCode: string;
  verificationToken: string;
  endpoint: string;
}) {
  const endpoint = normalizeEbayDeletionEndpoint(input.endpoint);

  return createHash("sha256")
    .update(input.challengeCode, "utf8")
    .update(input.verificationToken, "utf8")
    .update(endpoint, "utf8")
    .digest("hex");
}

export function ebayDeletionEndpointFromRequest(request: Request) {
  const url = new URL(request.url);
  return normalizeEbayDeletionEndpoint(`${url.origin}${url.pathname}`);
}
