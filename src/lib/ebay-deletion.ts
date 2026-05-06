import { createHash } from "node:crypto";

export function ebayDeletionChallengeResponse(input: {
  challengeCode: string;
  verificationToken: string;
  endpoint: string;
}) {
  return createHash("sha256")
    .update(input.challengeCode, "utf8")
    .update(input.verificationToken, "utf8")
    .update(input.endpoint, "utf8")
    .digest("hex");
}

export function ebayDeletionEndpointFromRequest(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}${url.pathname}`;
}
