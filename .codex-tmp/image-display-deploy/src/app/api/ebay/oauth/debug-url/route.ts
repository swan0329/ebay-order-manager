import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  assertEbayOAuthAuthorizationUrl,
  authorizationUrlDiagnostics,
  buildAuthorizationUrl,
  maskAuthorizationUrlForLog,
} from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { safeLog } from "@/lib/safe-log";
import { requireUser } from "@/lib/session";

function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 10 * 60,
    path: "/",
  };
}

export async function GET(request: Request) {
  await requireUser();

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set("ebay_oauth_state", state, oauthStateCookieOptions());

  const authorizationUrl = buildAuthorizationUrl(state);
  assertEbayOAuthAuthorizationUrl(authorizationUrl);

  const config = getEbayConfig();
  const diagnostics = authorizationUrlDiagnostics(authorizationUrl);
  const expectedCallbackUrl = new URL("/api/ebay/callback", request.url).toString();
  const tokenEndpoint = `${config.hosts.api}/identity/v1/oauth2/token`;
  const identityEndpoint = `${config.hosts.identity}/commerce/identity/v1/user/`;

  safeLog("info", "ebay.oauth.debug_url.generated", {
    environment: config.environment,
    ...diagnostics,
    expectedCallbackUrl,
    tokenEndpoint,
    identityEndpoint,
    authorizationUrl: maskAuthorizationUrlForLog(authorizationUrl),
  });

  return Response.json(
    {
      environment: config.environment,
      authorizationUrl,
      authorizationUrlForLog: maskAuthorizationUrlForLog(authorizationUrl),
      expectedCallbackUrl,
      tokenEndpoint,
      identityEndpoint,
      diagnostics,
      note: "Open authorizationUrl manually in the same browser session. It sets a fresh OAuth state cookie before returning this response.",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
