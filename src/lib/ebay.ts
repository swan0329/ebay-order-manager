import type { EbayAccount } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getEbayConfig } from "@/lib/env";
import { imageUrlFromBrowseItemPayload } from "@/lib/order-images";
import { safeLog } from "@/lib/safe-log";
export { buildOrderFilter, type OrderSyncFilters } from "@/lib/ebay-filter";
import { buildOrderFilter, type OrderSyncFilters } from "@/lib/ebay-filter";

export type EbayLineItemReference = {
  lineItemId: string;
  quantity: number;
};

type EbayTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
};

type EbayUserProfile = {
  userId?: string;
  username?: string;
  [key: string]: unknown;
};

type LegacyListingImageInput = {
  legacyItemId: string;
  legacyVariationId?: string | null;
  legacyVariationSku?: string | null;
  marketplaceId?: string | null;
};

let applicationAccessTokenCache: { token: string; expiresAt: number } | null = null;

export class EbayApiError extends Error {
  status: number;
  body: unknown;
  diagnostics?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    body: unknown,
    diagnostics?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EbayApiError";
    this.status = status;
    this.body = body;
    this.diagnostics = diagnostics;
  }
}

function credentialsHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function parseEbayResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function addHours(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

function safeTokenBodyDiagnostics(params: URLSearchParams) {
  const config = getEbayConfig();
  const endpoint = `${config.hosts.api}/identity/v1/oauth2/token`;
  const grantType = params.get("grant_type");
  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");

  return {
    endpoint,
    tokenHost: new URL(endpoint).hostname,
    environment: config.environment,
    contentType: "application/x-www-form-urlencoded",
    usesBasicAuthorization: true,
    clientIdPrefix: config.clientId.slice(0, 10),
    clientSecretPresent: Boolean(config.clientSecret),
    clientSecretLength: config.clientSecret.length,
    formKeys: Array.from(params.keys()),
    grantType,
    grantTypeIsAuthorizationCode: grantType === "authorization_code",
    grantTypeIsClientCredentials: grantType === "client_credentials",
    redirectUri,
    redirectUriMatchesConfiguredRuName: redirectUri
      ? redirectUri === config.ruName
      : null,
    redirectUriLooksLikeCallbackUrl: Boolean(redirectUri && /^https?:\/\//.test(redirectUri)),
    callbackUrlInBody: Array.from(params.values()).some((value) =>
      value.includes("/api/ebay/callback"),
    ),
    codePresent: Boolean(code),
    codeLength: code?.length ?? 0,
    codeContainsWhitespace: Boolean(code && /\s/.test(code)),
    codeContainsPercentEscape: Boolean(code && /%[0-9a-f]{2}/i.test(code)),
    codeContainsReplacementChar: Boolean(code && code.includes("\uFFFD")),
  };
}

export function buildAuthorizationUrl(state: string) {
  const config = getEbayConfig();
  const url = new URL("/oauth2/authorize", config.hosts.auth);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);

  return url.toString();
}

export function maskAuthorizationUrlForLog(authorizationUrl: string) {
  const config = getEbayConfig();
  const url = new URL(authorizationUrl);

  if (url.searchParams.has("client_id")) {
    url.searchParams.set("client_id", `${config.clientId.slice(0, 10)}...`);
  }

  if (url.searchParams.has("state")) {
    url.searchParams.set("state", "[STATE]");
  }

  return url.toString();
}

export function authorizationUrlDiagnostics(authorizationUrl: string) {
  const config = getEbayConfig();
  const url = new URL(authorizationUrl);

  return {
    host: url.hostname,
    endpoint: `${url.origin}${url.pathname}`,
    clientIdPrefix: config.clientId.slice(0, 10),
    redirectUri: url.searchParams.get("redirect_uri"),
    responseType: url.searchParams.get("response_type"),
    scope: url.searchParams.get("scope"),
    stateExists: Boolean(url.searchParams.get("state")),
    startsWithOauthAuthorize: authorizationUrl.startsWith(
      `${config.hosts.auth}/oauth2/authorize`,
    ),
    usesLegacyAuthnAuth:
      url.hostname === "signin.ebay.com" || url.pathname === "/ws/eBayISAPI.dll",
  };
}

export function assertEbayOAuthAuthorizationUrl(authorizationUrl: string) {
  const config = getEbayConfig();
  const url = new URL(authorizationUrl);
  const expectedUrl = new URL("/oauth2/authorize", config.hosts.auth);

  if (url.hostname === "signin.ebay.com" || url.pathname === "/ws/eBayISAPI.dll") {
    throw new Error("Generated eBay authorization URL uses legacy Auth'n'Auth.");
  }

  if (url.origin !== expectedUrl.origin || url.pathname !== expectedUrl.pathname) {
    throw new Error("Generated eBay authorization URL is not the OAuth authorize endpoint.");
  }

  if (!url.searchParams.get("client_id")) {
    throw new Error("Generated eBay authorization URL is missing client_id.");
  }

  if (url.searchParams.get("redirect_uri") !== config.ruName) {
    throw new Error("Generated eBay authorization URL has an unexpected redirect_uri.");
  }

  if (url.searchParams.get("response_type") !== "code") {
    throw new Error("Generated eBay authorization URL must request an authorization code.");
  }

  if (!url.searchParams.get("scope")) {
    throw new Error("Generated eBay authorization URL is missing scope.");
  }

  if (!url.searchParams.get("state")) {
    throw new Error("Generated eBay authorization URL is missing state.");
  }
}

async function requestToken(params: URLSearchParams) {
  const config = getEbayConfig();
  const endpoint = `${config.hosts.api}/identity/v1/oauth2/token`;
  const diagnostics = safeTokenBodyDiagnostics(params);

  safeLog("info", "ebay.oauth.token_exchange.request", diagnostics);

  const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: credentialsHeader(config.clientId, config.clientSecret),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
  });
  const body = await parseEbayResponse(response);

  if (!response.ok) {
    safeLog("error", "ebay.oauth.token_exchange.response_failed", {
      ...diagnostics,
      status: response.status,
      error: body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).error
        : undefined,
      errorDescription: body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).error_description
        : undefined,
      responseBodyType: body === null ? "empty" : typeof body,
    });
    throw new EbayApiError("eBay token request failed.", response.status, body, diagnostics);
  }

  return body as EbayTokenResponse;
}

async function getApplicationAccessToken(force = false) {
  if (
    !force &&
    applicationAccessTokenCache &&
    applicationAccessTokenCache.expiresAt > Date.now()
  ) {
    return applicationAccessTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });
  const token = await requestToken(body);

  applicationAccessTokenCache = {
    token: token.access_token,
    expiresAt: Date.now() + Math.max(token.expires_in - 300, 0) * 1000,
  };

  return token.access_token;
}

export async function exchangeAuthorizationCode(code: string) {
  const config = getEbayConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.ruName,
  });

  return requestToken(body);
}

export async function refreshAccountAccessToken(account: EbayAccount) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptSecret(account.refreshTokenEncrypted),
    scope: account.scopes,
  });
  const token = await requestToken(body);

  await prisma.ebayAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptSecret(token.access_token),
      expiresAt: addHours(token.expires_in),
    },
  });

  return token.access_token;
}

export async function getValidAccessToken(account: EbayAccount, force = false) {
  const expiresWithBuffer = account.expiresAt.getTime() - 5 * 60 * 1000;

  if (!force && expiresWithBuffer > Date.now()) {
    return decryptSecret(account.accessTokenEncrypted);
  }

  return refreshAccountAccessToken(account);
}

async function ebayFetch(
  account: EbayAccount,
  url: URL,
  init?: RequestInit,
  forceRefresh = false,
) {
  const token = await getValidAccessToken(account, forceRefresh);
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 && !forceRefresh) {
    return ebayFetch(account, url, init, true);
  }

  const body = await parseEbayResponse(response);

  if (!response.ok) {
    safeLog("error", "ebay.api.request_failed", {
      endpoint: `${url.origin}${url.pathname}`,
      method: init?.method ?? "GET",
      status: response.status,
      queryKeys: Array.from(url.searchParams.keys()),
      body,
    });

    throw new EbayApiError("eBay API request failed.", response.status, body);
  }

  return { response, body };
}

async function ebayApplicationFetch(
  url: URL,
  init?: RequestInit,
  forceRefresh = false,
) {
  const token = await getApplicationAccessToken(forceRefresh);
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 && !forceRefresh) {
    applicationAccessTokenCache = null;
    return ebayApplicationFetch(url, init, true);
  }

  const body = await parseEbayResponse(response);

  if (!response.ok) {
    safeLog("warn", "ebay.browse.request_failed", {
      endpoint: `${url.origin}${url.pathname}`,
      method: init?.method ?? "GET",
      status: response.status,
      queryKeys: Array.from(url.searchParams.keys()),
      body,
    });

    throw new EbayApiError("eBay Browse API request failed.", response.status, body);
  }

  return { response, body };
}

export async function getOrdersFromEbay(
  account: EbayAccount,
  filters: OrderSyncFilters,
  limit = 100,
  offset = 0,
) {
  const config = getEbayConfig();
  const url = new URL("/sell/fulfillment/v1/order", config.hosts.api);
  const filter = buildOrderFilter(filters);

  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (filter) {
    url.searchParams.set("filter", filter);
  }

  const result = await ebayFetch(account, url);
  return result.body as { orders?: unknown[]; total?: number; href?: string };
}

export async function getEbayListingImageUrl({
  legacyItemId,
  legacyVariationId,
  legacyVariationSku,
  marketplaceId,
}: LegacyListingImageInput) {
  const config = getEbayConfig();
  const url = new URL("/buy/browse/v1/item/get_item_by_legacy_id", config.hosts.api);
  const resolvedMarketplaceId =
    marketplaceId ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";

  url.searchParams.set("legacy_item_id", legacyItemId);

  if (legacyVariationId) {
    url.searchParams.set("legacy_variation_id", legacyVariationId);
  } else if (legacyVariationSku) {
    url.searchParams.set("legacy_variation_sku", legacyVariationSku);
  }

  safeLog("info", "ebay.browse.legacy_item_image.request", {
    endpoint: `${url.origin}${url.pathname}`,
    environment: config.environment,
    legacyItemIdPresent: Boolean(legacyItemId),
    legacyVariationIdPresent: Boolean(legacyVariationId),
    legacyVariationSkuPresent: Boolean(legacyVariationSku),
    marketplaceId: resolvedMarketplaceId,
  });

  const result = await ebayApplicationFetch(url, {
    headers: {
      "x-ebay-c-marketplace-id": resolvedMarketplaceId,
    },
  });
  const imageUrl = imageUrlFromBrowseItemPayload(result.body);

  safeLog("info", "ebay.browse.legacy_item_image.response", {
    endpoint: `${url.origin}${url.pathname}`,
    imageFound: Boolean(imageUrl),
    legacyItemIdPresent: Boolean(legacyItemId),
    legacyVariationIdPresent: Boolean(legacyVariationId),
    legacyVariationSkuPresent: Boolean(legacyVariationSku),
    marketplaceId: resolvedMarketplaceId,
  });

  return imageUrl;
}

export async function createShippingFulfillment(
  account: EbayAccount,
  ebayOrderId: string,
  lineItems: EbayLineItemReference[],
  carrierCode: string,
  trackingNumber: string,
) {
  const config = getEbayConfig();
  const url = new URL(
    `/sell/fulfillment/v1/order/${encodeURIComponent(ebayOrderId)}/shipping_fulfillment`,
    config.hosts.api,
  );
  const result = await ebayFetch(account, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrierCode,
      trackingNumber,
    }),
  });
  const location = result.response.headers.get("location");
  const fulfillmentId = location?.split("/").filter(Boolean).at(-1) ?? trackingNumber;

  return { fulfillmentId, location };
}

export async function getShippingFulfillments(
  account: EbayAccount,
  ebayOrderId: string,
) {
  const config = getEbayConfig();
  const url = new URL(
    `/sell/fulfillment/v1/order/${encodeURIComponent(ebayOrderId)}/shipping_fulfillment`,
    config.hosts.api,
  );
  const result = await ebayFetch(account, url);
  return result.body as { fulfillments?: unknown[] };
}

export async function getShippingFulfillment(
  account: EbayAccount,
  ebayOrderId: string,
  fulfillmentId: string,
) {
  const config = getEbayConfig();
  const url = new URL(
    `/sell/fulfillment/v1/order/${encodeURIComponent(ebayOrderId)}/shipping_fulfillment/${encodeURIComponent(fulfillmentId)}`,
    config.hosts.api,
  );
  const result = await ebayFetch(account, url);
  return result.body as unknown;
}

export async function getEbayUserProfile(accessToken: string) {
  const config = getEbayConfig();
  const url = new URL("/commerce/identity/v1/user/", config.hosts.identity);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await parseEbayResponse(response);

  if (!response.ok) {
    throw new EbayApiError("eBay identity request failed.", response.status, body);
  }

  return body as EbayUserProfile;
}

export function tokenExpiryDate(token: EbayTokenResponse) {
  return addHours(token.expires_in);
}

export function refreshTokenExpiryDate(token: EbayTokenResponse) {
  return token.refresh_token_expires_in
    ? addHours(token.refresh_token_expires_in)
    : null;
}
