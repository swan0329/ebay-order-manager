import type { EbayAccount } from "@/generated/prisma";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { EbayApiError, getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";

export const sellInventoryScope = "https://api.ebay.com/oauth/api_scope/sell.inventory";
export const sellAccountReadonlyScope =
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly";
export const sellMarketingScope = "https://api.ebay.com/oauth/api_scope/sell.marketing";
export const sellMarketingReadonlyScope =
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly";
const EBAY_REQUEST_TIMEOUT_MS = 25_000;

type EbayApiRequestInput = {
  method?: string;
  path: string;
  query?: Record<string, string | number | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  contentLanguage?: string;
  retry?: boolean;
};

type EbayApiRawRequestInput = {
  method?: string;
  path: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  retry?: boolean;
  responseType?: "text" | "buffer";
};

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

export function accountHasScope(account: Pick<EbayAccount, "scopes">, scope: string) {
  return account.scopes.split(/\s+/).includes(scope);
}

export async function getActiveEbayAccount(userId: string) {
  const account = await prisma.ebayAccount.findFirst({
    where: { userId, environment: currentEbayEnvironment() },
    orderBy: { updatedAt: "desc" },
  });

  if (!account) {
    throw new Error("eBay 계정이 연결되어 있지 않습니다.");
  }

  return account;
}

export async function getActiveEbayInventoryAccount(userId: string) {
  const account = await getActiveEbayAccount(userId);

  if (!accountHasScope(account, sellInventoryScope)) {
    throw new Error(
      "eBay Inventory API 권한이 없습니다. eBay 연결을 다시 진행해 sell.inventory 권한을 승인해야 합니다.",
    );
  }

  return account;
}

export async function getActiveEbayAccountPolicyAccount(userId: string) {
  const account = await getActiveEbayAccount(userId);

  if (!accountHasScope(account, sellAccountReadonlyScope)) {
    throw new Error(
      "eBay 정책 조회 권한이 없습니다. eBay 연결을 다시 진행해 sell.account.readonly 권한을 승인해야 합니다.",
    );
  }

  return account;
}

export async function getActiveEbayMarketingAccount(userId: string, write = false) {
  const account = await getActiveEbayInventoryAccount(userId);
  const requiredScope = write ? sellMarketingScope : sellMarketingReadonlyScope;

  if (!accountHasScope(account, requiredScope)) {
    throw new Error(
      write
        ? "eBay Marketing API write permission is missing. Reconnect eBay with sell.marketing scope."
        : "eBay Marketing API read permission is missing. Reconnect eBay with sell.marketing.readonly scope.",
    );
  }

  return account;
}

export async function ebayApiRequest(
  account: EbayAccount,
  input: EbayApiRequestInput,
) {
  const retrySafe = input.path.startsWith("/sell/inventory/v1/") && ["GET", "PUT"].includes(input.method ?? "GET");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ebayApiRequestOnce(account, input);
    } catch (error) {
      const temporary = error instanceof EbayApiError && (error.status >= 500 ||
        (error.status === 400 && typeof error.body === "object" && error.body !== null &&
          "errors" in error.body && Array.isArray(error.body.errors) && error.body.errors.some((entry: { errorId?: number; message?: string }) => Number(entry.errorId) === 25001 || (Number(entry.errorId) === 25604 && /Availability not found.*try again/i.test(entry.message ?? "")))));
      if (!(retrySafe && temporary && attempt < 2)) {
        if (error instanceof EbayApiError) {
          const sku = input.path.match(/^\/sell\/inventory\/v1\/inventory_item\/([^/]+)$/)?.[1];
          if (sku) error.diagnostics = { ...error.diagnostics, inventorySku: decodeURIComponent(sku) };
        }
        throw error;
      }
      safeLog("warn", "ebay.inventory.retry", { path: input.path, method: input.method ?? "GET", attempt: attempt + 1, status: error.status });
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1000 : 3000));
    }
  }
}

async function ebayApiRequestOnce(
  account: EbayAccount,
  input: EbayApiRequestInput,
): Promise<{ body: unknown; status: number; headers: Headers }> {
  const config = getEbayConfig();
  const url = new URL(input.path, config.hosts.api);

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== null && value !== undefined && String(value) !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const token = await getValidAccessToken(account, input.retry === true);
  const hasBody = input.body !== undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json",
        // Undici can otherwise send `Accept-Language: *`. eBay rejects that
        // value with Inventory API error 25709, so always send a real locale.
        "accept-language": input.contentLanguage ?? "en-US",
        authorization: `Bearer ${token}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(input.contentLanguage ? { "content-language": input.contentLanguage } : {}),
        ...(input.headers ?? {}),
      },
      body: hasBody ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new EbayApiError(
      timedOut
        ? "eBay 응답 시간이 초과되었습니다. 재시도하면 기존 SKU를 먼저 확인합니다."
        : "eBay Inventory API에 연결하지 못했습니다.",
      timedOut ? 504 : 502,
      null,
    );
  }

  if (response.status === 401 && !input.retry) {
    return ebayApiRequestOnce(account, { ...input, retry: true });
  }

  const body = await parseEbayResponse(response);

  if (!response.ok) {
    safeLog("error", "ebay.inventory.request_failed", {
      endpoint: `${url.origin}${url.pathname}`,
      method: input.method ?? "GET",
      status: response.status,
      queryKeys: Array.from(url.searchParams.keys()),
      body,
    });
    throw new EbayApiError("eBay Inventory API request failed.", response.status, body);
  }

  return { body, status: response.status, headers: response.headers };
}

export function ebayApiRawRequest(
  account: EbayAccount,
  input: EbayApiRawRequestInput & { responseType: "buffer" },
): Promise<{ body: Buffer; status: number; headers: Headers }>;
export function ebayApiRawRequest(
  account: EbayAccount,
  input: EbayApiRawRequestInput,
): Promise<{ body: string; status: number; headers: Headers }>;
export async function ebayApiRawRequest(
  account: EbayAccount,
  input: EbayApiRawRequestInput,
): Promise<{ body: string | Buffer; status: number; headers: Headers }> {
  const config = getEbayConfig();
  const url = new URL(input.path, config.hosts.api);
  const token = await getValidAccessToken(account, input.retry === true);
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json, application/xml, text/xml, */*",
        authorization: `Bearer ${token}`,
        ...(input.headers ?? {}),
      },
      body: input.body,
      signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new EbayApiError(
      timedOut ? "eBay 결과 파일 응답 시간이 초과되었습니다." : "eBay Feed API에 연결하지 못했습니다.",
      timedOut ? 504 : 502,
      null,
    );
  }

  if (response.status === 401 && !input.retry) {
    return ebayApiRawRequest(account, { ...input, retry: true });
  }

  const body = response.ok && input.responseType === "buffer"
    ? Buffer.from(await response.arrayBuffer())
    : await response.text();
  if (!response.ok) {
    safeLog("error", "ebay.feed.request_failed", {
      endpoint: `${url.origin}${url.pathname}`,
      method: input.method ?? "GET",
      status: response.status,
      responseBodyType: body ? (Buffer.isBuffer(body) ? "buffer" : "text") : "empty",
    });
    throw new EbayApiError("eBay Feed API request failed.", response.status, body);
  }

  return { body, status: response.status, headers: response.headers };
}
