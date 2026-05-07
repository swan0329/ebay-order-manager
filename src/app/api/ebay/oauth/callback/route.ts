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
import { getCurrentUser } from "@/lib/session";
import { writeSyncLog } from "@/lib/orders";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("ebay_oauth_state")?.value;

  if (error) {
    redirect(`/connect?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    redirect("/connect?error=invalid_oauth_state");
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const config = getEbayConfig();
  const token = await exchangeAuthorizationCode(code).catch(async (tokenError) => {
    const message =
      tokenError instanceof EbayApiError
        ? `eBay 토큰 요청 실패 (${tokenError.status})`
        : asErrorMessage(tokenError);

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

  if (!token.refresh_token) {
    redirect("/connect?error=missing_refresh_token");
  }

  const profile = await getEbayUserProfile(token.access_token).catch(
    () => ({ userId: null, username: null }) as Record<string, unknown>,
  );
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

  if (existing) {
    await prisma.ebayAccount.update({ where: { id: existing.id }, data });
  } else {
    await prisma.ebayAccount.create({ data: { userId: user.id, ...data } });
  }

  await writeSyncLog(
    user.id,
    "ebay.oauth",
    SyncStatus.SUCCESS,
    `Connected eBay account ${username ?? ebayUserId ?? "unknown"}.`,
    profile as Prisma.InputJsonValue,
  );

  cookieStore.delete("ebay_oauth_state");
  redirect("/connect?connected=1");
}
