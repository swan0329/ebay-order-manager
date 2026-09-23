import { createHash } from "node:crypto";

export const ebayDeletionVerificationTokenPattern = /^[A-Za-z0-9_-]{32,80}$/;

export function trimEbayDeletionEndpoint(endpoint: string) {
  return endpoint.trim();
}

export function ebayDeletionChallengeResponse(input: {
  challengeCode: string;
  verificationToken: string;
  endpoint: string;
}) {
  const endpoint = trimEbayDeletionEndpoint(input.endpoint);

  return createHash("sha256")
    .update(input.challengeCode, "utf8")
    .update(input.verificationToken, "utf8")
    .update(endpoint, "utf8")
    .digest("hex");
}

export function ebayDeletionEndpointFromRequest(request: Request) {
  const url = new URL(request.url);
  return trimEbayDeletionEndpoint(`${url.origin}${url.pathname}`);
}
