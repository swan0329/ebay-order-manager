export type EbayEnvironmentName = "sandbox" | "production";

export const defaultEbayScopes = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
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
  // 고정 토큰. 비어 있으면 자격 증명으로 그때그때 발급받는다.
  accessToken: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  locationId: string | null;
};

/**
 * Shopify Admin API config for a single store, via a Custom App access token.
 *
 * - SHOPIFY_STORE_DOMAIN: "your-store.myshopify.com" (no protocol)
 * - SHOPIFY_ADMIN_ACCESS_TOKEN: 고정 토큰. 예전 방식이며 있으면 그대로 쓴다.
 * - SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET: Dev Dashboard 앱의 자격 증명.
 *   이 둘이 있으면 토큰을 그때그때 발급받는다. 발급된 토큰은 24시간 뒤 만료되므로
 *   고정 토큰을 환경변수에 넣어 두는 방식은 하루가 지나면 멈춘다.
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

  return {
    storeDomain,
    // 고정 토큰이 없으면 자격 증명으로 발급받는다. 둘 중 하나는 있어야 한다.
    accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || "",
    clientId: process.env.SHOPIFY_CLIENT_ID?.trim() || "",
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET?.trim() || "",
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
