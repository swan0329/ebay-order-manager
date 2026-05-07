import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthorizationUrl } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { asErrorMessage } from "@/lib/http";
import { safeLog } from "@/lib/safe-log";
import { requireUser } from "@/lib/session";

export async function GET() {
  await requireUser();

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });

  let authorizationUrl: string;

  try {
    authorizationUrl = buildAuthorizationUrl(state);
    const config = getEbayConfig();
    const url = new URL(authorizationUrl);
    safeLog("info", "ebay.oauth.start.redirect", {
      environment: config.environment,
      authHost: url.hostname,
      redirectUriPresent: Boolean(url.searchParams.get("redirect_uri")),
      redirectUriLooksLikeUrl: /^https?:\/\//.test(
        url.searchParams.get("redirect_uri") ?? "",
      ),
      scopesCount: config.scopes.length,
    });
  } catch (error) {
    safeLog("error", "ebay.oauth.start.failed", {
      message: asErrorMessage(error),
    });
    redirect(
      `/connect?error=${encodeURIComponent(
        `eBay 설정값을 확인해 주세요. ${asErrorMessage(error)}`,
      )}`,
    );
  }

  redirect(authorizationUrl);
}
