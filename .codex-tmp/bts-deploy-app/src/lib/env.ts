export type EbayEnvironmentName = "sandbox" | "production";

export const defaultEbayScopes = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function getEbayEnvironment(): EbayEnvironmentName {
  return process.env.EBAY_ENV === "production" ? "production" : "sandbox";
}

export function getEbayScopes(): string[] {
  const raw = process.env.EBAY_SCOPES?.trim();
  return raw ? raw.split(/\s+/) : defaultEbayScopes;
}

export type ShopifyConfig = {
  storeDomain: string;
  accessToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  apiVersion: string;
  locationId: string | null;
};

/**
 * Shopify Admin API config for a single store, via a Custom App access token.
 *
 * - SHOPIFY_STORE_DOMAIN: "your-store.myshopify.com" (no protocol)
 * - SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET: server integration credentials.
 *   The server exchanges these for a short-lived access token and caches it.
 * - SHOPIFY_ADMIN_ACCESS_TOKEN: optional static-token fallback for a legacy
 *   admin-created custom app.
 * - SHOPIFY_API_VERSION: optional, e.g. "2025-10". Defaults below — bump it as
 *   Shopify ages versions out (~1 year support window).
 * - SHOPIFY_LOCATION_ID: optional. If unset, the primary location is fetched
 *   automatically the first time inventory is set.
 */
export function getShopifyConfig(): ShopifyConfig {
  const rawDomain = requiredEnv("SHOPIFY_STORE_DOMAIN").trim();
  const storeDomain = rawDomain
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || null;
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim() || null;
  if (!accessToken && (!clientId || !clientSecret)) {
    throw new Error(
      "SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET is required.",
    );
  }

  return {
    storeDomain,
    accessToken,
    clientId,
    clientSecret,
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || "2025-10",
    locationId: process.env.SHOPIFY_LOCATION_ID?.trim() || null,
  };
}

export function getEbayConfig() {
  const environment = getEbayEnvironment();

  return {
    environment,
    clientId: requiredEnv("EBAY_CLIENT_ID"),
    clientSecret: requiredEnv("EBAY_CLIENT_SECRET"),
    ruName: requiredEnv("EBAY_RU_NAME"),
    scopes: getEbayScopes(),
    hosts:
      environment === "production"
        ? {
            auth: "https://auth.ebay.com",
            api: "https://api.ebay.com",
            identity: "https://apiz.ebay.com",
          }
        : {
            auth: "https://auth.sandbox.ebay.com",
            api: "https://api.sandbox.ebay.com",
            identity: "https://apiz.sandbox.ebay.com",
          },
  };
}
