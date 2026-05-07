import { describe, expect, it } from "vitest";
import { GET as expectedCallbackGet } from "../src/app/api/ebay/callback/route";
import { GET as canonicalCallbackGet } from "../src/app/api/ebay/oauth/callback/route";

describe("eBay OAuth callback route", () => {
  it("serves the eBay Developer Console callback URL", () => {
    expect(expectedCallbackGet).toBe(canonicalCallbackGet);
  });
});
