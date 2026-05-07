import { afterEach, describe, expect, it } from "vitest";
import {
  assertEbayOAuthAuthorizationUrl,
  buildAuthorizationUrl,
  maskAuthorizationUrlForLog,
} from "../src/lib/ebay";

const originalEnv = {
  EBAY_ENV: process.env.EBAY_ENV,
  EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
  EBAY_RU_NAME: process.env.EBAY_RU_NAME,
  EBAY_SCOPES: process.env.EBAY_SCOPES,
};

function setProductionEnv() {
  process.env.EBAY_ENV = "production";
  process.env.EBAY_CLIENT_ID = "client-id";
  process.env.EBAY_CLIENT_SECRET = "client-secret";
  process.env.EBAY_RU_NAME = "LEE_SOOHAN-LEESOOHA-OrderM-owdlg";
  process.env.EBAY_SCOPES =
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/commerce.identity.readonly";
}

afterEach(() => {
  process.env.EBAY_ENV = originalEnv.EBAY_ENV;
  process.env.EBAY_CLIENT_ID = originalEnv.EBAY_CLIENT_ID;
  process.env.EBAY_CLIENT_SECRET = originalEnv.EBAY_CLIENT_SECRET;
  process.env.EBAY_RU_NAME = originalEnv.EBAY_RU_NAME;
  process.env.EBAY_SCOPES = originalEnv.EBAY_SCOPES;
});

describe("eBay OAuth authorization URL", () => {
  it("builds the production OAuth authorize URL, not the legacy Auth'n'Auth URL", () => {
    setProductionEnv();

    const authorizationUrl = buildAuthorizationUrl("state-value");
    const url = new URL(authorizationUrl);

    expect(url.origin + url.pathname).toBe(
      "https://auth.ebay.com/oauth2/authorize",
    );
    expect(url.origin + url.pathname).not.toBe(
      "https://signin.ebay.com/ws/eBayISAPI.dll",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "LEE_SOOHAN-LEESOOHA-OrderM-owdlg",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain(
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    );
    expect(url.searchParams.get("state")).toBe("state-value");

    expect(() => assertEbayOAuthAuthorizationUrl(authorizationUrl)).not.toThrow();
  });

  it("rejects legacy Auth'n'Auth URLs before redirecting the browser", () => {
    setProductionEnv();

    expect(() =>
      assertEbayOAuthAuthorizationUrl(
        "https://signin.ebay.com/ws/eBayISAPI.dll?SignIn&RuName=LEE_SOOHAN-LEESOOHA-OrderM-owdlg",
      ),
    ).toThrow("legacy Auth'n'Auth");
  });

  it("masks client_id and state in diagnostic logs", () => {
    setProductionEnv();

    expect(maskAuthorizationUrlForLog(buildAuthorizationUrl("state-value"))).toBe(
      "https://auth.ebay.com/oauth2/authorize?client_id=%5BCLIENT_ID%5D&redirect_uri=LEE_SOOHAN-LEESOOHA-OrderM-owdlg&response_type=code&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.fulfillment+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fcommerce.identity.readonly&state=%5BSTATE%5D",
    );
  });
});
