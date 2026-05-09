import type { EbayAccount } from "@/generated/prisma";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { EbayApiError, getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";

export const sellInventoryScope = "https://api.ebay.com/oauth/api_scope/sell.inventory";

type EbayApiRequestInput = {
  method?: string;
  path: string;
  query?: Record<string, string | number | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  contentLanguage?: string;
  retry?: boolean;
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

export function accountHasScope(account: EbayAccount, scope: string) {
  return account.scopes.split(/\s+/).includes(scope);
}

export async function getActiveEbayInventoryAccount(userId: string) {
  const account = await prisma.ebayAccount.findFirst({
    where: { userId, environment: currentEbayEnvironment() },
    orderBy: { updatedAt: "desc" },
  });

  if (!account) {
    throw new Error("eBay 계정이 연결되어 있지 않습니다.");
  }

  if (!accountHasScope(account, sellInventoryScope)) {
    throw new Error(
      "eBay Inventory API 권한이 없습니다. eBay 연결을 다시 진행해 sell.inventory 권한을 승인해야 합니다.",
    );
  }

  return account;
}

export async function ebayApiRequest(
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
  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(input.contentLanguage ? { "content-language": input.contentLanguage } : {}),
      ...(input.headers ?? {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
  });

  if (response.status === 401 && !input.retry) {
    return ebayApiRequest(account, { ...input, retry: true });
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
