import { describe, expect, it } from "vitest";
import {
  manualOAuthStateForValidation,
  missingManualOAuthStateMessage,
  parseAuthorizationCodeInput,
} from "../src/lib/ebay-oauth";

describe("manual eBay OAuth code input", () => {
  it("extracts code and state from a callback URL", () => {
    expect(
      parseAuthorizationCodeInput(
        "https://example.com/api/ebay/callback?state=state-value&code=v%5E1.1%23code&expires_in=299",
      ),
    ).toEqual({
      code: "v^1.1#code",
      state: "state-value",
      source: "url",
    });
  });

  it("extracts code and state from a pasted query string", () => {
    expect(parseAuthorizationCodeInput("code=abc123&state=state-value")).toEqual({
      code: "abc123",
      state: "state-value",
      source: "query",
    });
  });

  it("accepts a raw authorization code", () => {
    expect(parseAuthorizationCodeInput("v^1.1#raw-code")).toEqual({
      code: "v^1.1#raw-code",
      state: null,
      source: "code",
    });
  });

  it("decodes a raw copied code value", () => {
    expect(parseAuthorizationCodeInput("v%5E1.1%23raw-code")).toEqual({
      code: "v^1.1#raw-code",
      state: null,
      source: "code",
    });
  });

  it("handles html-escaped query strings without double decoding", () => {
    expect(parseAuthorizationCodeInput("code=v%255E1.1%2523code&amp;state=s%253D1")).toEqual({
      code: "v%5E1.1%23code",
      state: "s%3D1",
      source: "query",
    });
  });

  it("uses state extracted from the pasted URL before a separate stale state field", () => {
    expect(
      manualOAuthStateForValidation({
        parsedState: "state-from-url",
        explicitState: "stale-state-field",
      }),
    ).toBe("state-from-url");
  });

  it("falls back to a separate state field only when the pasted input has no state", () => {
    expect(
      manualOAuthStateForValidation({
        parsedState: null,
        explicitState: "state-from-field",
      }),
    ).toBe("state-from-field");
  });

  it("uses a clear missing-state message", () => {
    expect(missingManualOAuthStateMessage).toBe(
      "Retry OAuth first, then paste the full returned URL including state.",
    );
  });
});
