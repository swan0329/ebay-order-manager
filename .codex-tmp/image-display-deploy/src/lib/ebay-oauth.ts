import { Prisma, SyncStatus } from "@/generated/prisma";
import { encryptSecret } from "@/lib/crypto";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import {
  EbayApiError,
  exchangeAuthorizationCode,
  getEbayUserProfile,
  refreshTokenExpiryDate,
  tokenExpiryDate,
} from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { asErrorMessage } from "@/lib/http";
import { writeSyncLog } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";

type OAuthLogPrefix = "ebay.oauth.callback" | "ebay.oauth.manual_code";

type UserRef = {
  id: string;
};

export type AuthorizationCodeInput = {
  code: string | null;
  state: string | null;
  source: "url" | "query" | "code";
};

export const missingManualOAuthStateMessage =
  "Retry OAuth first, then paste the full returned URL including state.";

function trimPastedValue(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^["']|["']$/g, "") ?? "";

  return trimmed || null;
}

function decodeRawCodeValue(value: string | null | undefined) {
  const trimmed = trimPastedValue(value);

  if (!trimmed || !/%[0-9a-f]{2}/i.test(trimmed)) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function codeInputFromParams(
  params: URLSearchParams,
  source: AuthorizationCodeInput["source"],
): AuthorizationCodeInput {
  return {
    code: trimPastedValue(params.get("code")),
    state: trimPastedValue(params.get("state")),
    source,
  };
}

export function parseAuthorizationCodeInput(input: string): AuthorizationCodeInput {
  const trimmed = input.trim().replaceAll("&amp;", "&");

  if (!trimmed) {
    return { code: null, state: null, source: "code" };
  }

  try {
    const url = new URL(trimmed);
    if (url.searchParams.has("code")) {
      return codeInputFromParams(url.searchParams, "url");
    }

    const hashParams = new URLSearchParams(url.hash.replace(/^#\??/, ""));
    return codeInputFromParams(hashParams, "url");
  } catch {
    // Fall through to query-string parsing.
  }

  const query = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
  if (query.includes("=") && /(^|&)code=/.test(query)) {
    const params = new URLSearchParams(query);
    return codeInputFromParams(params, "query");
  }

  return { code: decodeRawCodeValue(trimmed), state: null, source: "code" };
}

export function manualOAuthStateForValidation({
  parsedState,
  explicitState,
}: {
  parsedState: string | null;
  explicitState?: string | null;
}) {
  return trimPastedValue(parsedState) ?? trimPastedValue(explicitState);
}

function ebayErrorDetail(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const parts = [
    record.error,
    record.error_description,
    record.message,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return parts.length ? parts.join(": ") : null;
}

function safeExchangeDiagnostics(error: EbayApiError) {
  return {
    request: error.diagnostics,
    response: {
      status: error.status,
      body: error.body,
    },
  };
}

export async function completeEbayOAuthConnection({
  user,
  code,
  path,
  logPrefix,
}: {
  user: UserRef;
  code: string;
  path: string;
  logPrefix: OAuthLogPrefix;
}) {
  const config = getEbayConfig();

  safeLog("info", `${logPrefix}.token_exchange.start`, {
    path,
    environment: config.environment,
    tokenHost: new URL(config.hosts.api).hostname,
  });

  const token = await exchangeAuthorizationCode(code).catch(async (tokenError) => {
    const ebayDetail =
      tokenError instanceof EbayApiError ? ebayErrorDetail(tokenError.body) : null;
    const message =
      tokenError instanceof EbayApiError
        ? `eBay token request failed (${tokenError.status})${
            ebayDetail ? `: ${ebayDetail}` : ""
          }`
        : asErrorMessage(tokenError);

    safeLog("error", `${logPrefix}.token_exchange.failed`, {
      path,
      environment: config.environment,
      status: tokenError instanceof EbayApiError ? tokenError.status : undefined,
      message,
      diagnostics:
        tokenError instanceof EbayApiError ? safeExchangeDiagnostics(tokenError) : undefined,
    });

    await writeSyncLog(
      user.id,
      "ebay.oauth",
      SyncStatus.FAILED,
      message,
      tokenError instanceof EbayApiError
        ? ({ status: tokenError.status, body: tokenError.body } as Prisma.InputJsonValue)
        : undefined,
    ).catch(() => undefined);

    const exchangeError = new Error(message) as Error & { details?: unknown };
    exchangeError.details =
      tokenError instanceof EbayApiError ? safeExchangeDiagnostics(tokenError) : undefined;

    throw exchangeError;
  });

  safeLog("info", `${logPrefix}.token_exchange.success`, {
    path,
    environment: config.environment,
    accessTokenReceived: Boolean(token.access_token),
    refreshTokenReceived: Boolean(token.refresh_token),
    expiresIn: token.expires_in,
    refreshTokenExpiresInPresent: Boolean(token.refresh_token_expires_in),
  });

  if (!token.refresh_token) {
    const message = "missing_refresh_token";

    safeLog("error", `${logPrefix}.missing_refresh_token`, {
      path,
      environment: config.environment,
    });

    await writeSyncLog(
      user.id,
      "ebay.oauth",
      SyncStatus.FAILED,
      message,
    ).catch(() => undefined);

    throw new Error(message);
  }

  const profile = await getEbayUserProfile(token.access_token).catch((profileError) => {
    safeLog("warn", `${logPrefix}.profile.failed`, {
      path,
      environment: config.environment,
      status: profileError instanceof EbayApiError ? profileError.status : undefined,
      message: asErrorMessage(profileError),
    });

    return { userId: null, username: null } as Record<string, unknown>;
  });
  const ebayUserId =
    typeof profile.userId === "string" ? profile.userId : undefined;
  const username =
    typeof profile.username === "string" ? profile.username : undefined;
  const environment = currentEbayEnvironment();
  const existing = await prisma.ebayAccount.findFirst({
    where: {
      userId: user.id,
      environment,
      ...(ebayUserId ? { ebayUserId } : {}),
    },
  });
  const data = {
    ebayUserId,
    username,
    environment,
    scopes: config.scopes.join(" "),
    accessTokenEncrypted: encryptSecret(token.access_token),
    refreshTokenEncrypted: encryptSecret(token.refresh_token),
    expiresAt: tokenExpiryDate(token),
    refreshTokenExpiresAt: refreshTokenExpiryDate(token),
    rawProfile: profile as Prisma.InputJsonValue,
  };

  let savedAccount: { id: string };

  try {
    savedAccount = existing
      ? await prisma.ebayAccount.update({ where: { id: existing.id }, data })
      : await prisma.ebayAccount.create({ data: { userId: user.id, ...data } });

    safeLog("info", `${logPrefix}.db_save.success`, {
      path,
      environment,
      accountId: savedAccount.id,
      existingAccountUpdated: Boolean(existing),
      ebayUserIdPresent: Boolean(ebayUserId),
      usernamePresent: Boolean(username),
    });

  } catch (saveError) {
    safeLog("error", `${logPrefix}.db_save.failed`, {
      path,
      environment,
      message: asErrorMessage(saveError),
    });
    throw saveError;
  }

  await writeSyncLog(
    user.id,
    "ebay.oauth",
    SyncStatus.SUCCESS,
    `Connected eBay account ${username ?? ebayUserId ?? "unknown"}.`,
    profile as Prisma.InputJsonValue,
  );

  return {
    accountId: savedAccount.id,
    environment,
    ebayUserId,
    username,
    existingAccountUpdated: Boolean(existing),
  };
}
