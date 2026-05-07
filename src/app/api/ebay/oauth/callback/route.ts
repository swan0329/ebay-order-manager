import { Prisma, SyncStatus } from "@/generated/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { getCurrentUser } from "@/lib/session";
import { writeSyncLog } from "@/lib/orders";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("ebay_oauth_state")?.value;

  safeLog("info", "ebay.oauth.callback.start", {
    path: url.pathname,
    codePresent: Boolean(code),
    statePresent: Boolean(state),
    expectedStatePresent: Boolean(expectedState),
    errorPresent: Boolean(error),
  });

  if (error) {
    safeLog("warn", "ebay.oauth.callback.provider_error", {
      path: url.pathname,
      error,
    });
    redirect(`/connect?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    safeLog("warn", "ebay.oauth.callback.invalid_state", {
      path: url.pathname,
      codePresent: Boolean(code),
      statePresent: Boolean(state),
      expectedStatePresent: Boolean(expectedState),
      stateMatches: Boolean(state && expectedState && state === expectedState),
    });
    redirect("/connect?error=invalid_oauth_state");
  }

  const user = await getCurrentUser();
  if (!user) {
    safeLog("warn", "ebay.oauth.callback.unauthenticated", {
      path: url.pathname,
    });
    redirect("/login");
  }

  const config = getEbayConfig();
  safeLog("info", "ebay.oauth.callback.token_exchange.start", {
    path: url.pathname,
    environment: config.environment,
    tokenHost: new URL(config.hosts.api).hostname,
  });

  const token = await exchangeAuthorizationCode(code).catch(async (tokenError) => {
    const message =
      tokenError instanceof EbayApiError
        ? `eBay token request failed (${tokenError.status})`
        : asErrorMessage(tokenError);

    safeLog("error", "ebay.oauth.callback.token_exchange.failed", {
      path: url.pathname,
      environment: config.environment,
      status: tokenError instanceof EbayApiError ? tokenError.status : undefined,
      message,
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

    redirect(`/connect?error=${encodeURIComponent(message)}`);
  });

  safeLog("info", "ebay.oauth.callback.token_exchange.success", {
    path: url.pathname,
    environment: config.environment,
    accessTokenReceived: Boolean(token.access_token),
    refreshTokenReceived: Boolean(token.refresh_token),
    expiresIn: token.expires_in,
    refreshTokenExpiresInPresent: Boolean(token.refresh_token_expires_in),
  });

  if (!token.refresh_token) {
    safeLog("error", "ebay.oauth.callback.missing_refresh_token", {
      path: url.pathname,
      environment: config.environment,
    });
    redirect("/connect?error=missing_refresh_token");
  }

  const profile = await getEbayUserProfile(token.access_token).catch((profileError) => {
    safeLog("warn", "ebay.oauth.callback.profile.failed", {
      path: url.pathname,
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

  try {
    const savedAccount = existing
      ? await prisma.ebayAccount.update({ where: { id: existing.id }, data })
      : await prisma.ebayAccount.create({ data: { userId: user.id, ...data } });

    safeLog("info", "ebay.oauth.callback.db_save.success", {
      path: url.pathname,
      environment,
      accountId: savedAccount.id,
      existingAccountUpdated: Boolean(existing),
      ebayUserIdPresent: Boolean(ebayUserId),
      usernamePresent: Boolean(username),
    });
  } catch (saveError) {
    safeLog("error", "ebay.oauth.callback.db_save.failed", {
      path: url.pathname,
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

  cookieStore.delete("ebay_oauth_state");
  safeLog("info", "ebay.oauth.callback.completed", {
    path: url.pathname,
    environment,
  });
  redirect("/connect?connected=1");
}
