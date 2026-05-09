export type EbayEnvironmentName = "sandbox" | "production";

export const defaultEbayScopes = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
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
