import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ebayDeletionChallengeResponse,
  ebayDeletionEndpointFromRequest,
} from "../src/lib/ebay-deletion";

describe("eBay marketplace account deletion challenge", () => {
  it("hashes challenge code, verification token, and endpoint in eBay order", () => {
    const input = {
      challengeCode: "challenge-123",
      verificationToken: "verification-token-01234567890123456789",
      endpoint: "https://example.vercel.app/api/ebay/deletion",
    };
    const expected = createHash("sha256")
      .update(input.challengeCode)
      .update(input.verificationToken)
      .update(input.endpoint)
      .digest("hex");

    expect(ebayDeletionChallengeResponse(input)).toBe(expected);
  });

  it("derives the endpoint without the challenge query string", () => {
    expect(
      ebayDeletionEndpointFromRequest(
        new Request(
          "https://example.vercel.app/api/ebay/deletion?challenge_code=abc",
        ),
      ),
    ).toBe("https://example.vercel.app/api/ebay/deletion");
  });
});
