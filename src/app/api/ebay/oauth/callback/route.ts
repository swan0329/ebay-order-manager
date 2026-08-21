import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asErrorMessage } from "@/lib/http";
import { completeEbayOAuthConnection } from "@/lib/ebay-oauth";
import { safeLog } from "@/lib/safe-log";
import { getCurrentUser } from "@/lib/session";

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

  const result = await completeEbayOAuthConnection({
    user,
    code,
    path: url.pathname,
    logPrefix: "ebay.oauth.callback",
  }).catch((connectError) => {
    redirect(`/connect?error=${encodeURIComponent(asErrorMessage(connectError))}`);
  });

  cookieStore.delete("ebay_oauth_state");
  safeLog("info", "ebay.oauth.callback.completed", {
    path: url.pathname,
    environment: result.environment,
    accountId: result.accountId,
  });
  // 인증 성공 직후에는 주문 화면으로 보내지 않는다. 연결 상태와 실제 API 호출 결과를
  // 확인할 수 있는 화면으로 돌아와야 "승인만 됐는지"를 명확히 알 수 있다.
  redirect("/connect?connected=1");
}
