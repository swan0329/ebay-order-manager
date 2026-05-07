import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  assertEbayOAuthAuthorizationUrl,
  authorizationUrlDiagnostics,
  buildAuthorizationUrl,
  maskAuthorizationUrlForLog,
} from "@/lib/ebay";
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

  const diagnostics = authorizationUrlDiagnostics(authorizationUrl);
  const expectedCallbackUrl = new URL("/api/ebay/callback", request.url).toString();

  safeLog("info", "ebay.oauth.debug_url.generated", {
    ...diagnostics,
    expectedCallbackUrl,
    authorizationUrl: maskAuthorizationUrlForLog(authorizationUrl),
  });

  return Response.json(
    {
      authorizationUrl,
      authorizationUrlForLog: maskAuthorizationUrlForLog(authorizationUrl),
      expectedCallbackUrl,
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
