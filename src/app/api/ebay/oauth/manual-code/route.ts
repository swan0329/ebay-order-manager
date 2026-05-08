import { cookies } from "next/headers";
import { z } from "zod";
import {
  completeEbayOAuthConnection,
  manualOAuthStateForValidation,
  missingManualOAuthStateMessage,
  parseAuthorizationCodeInput,
} from "@/lib/ebay-oauth";
import { getEbayConfig } from "@/lib/env";
import { asErrorMessage, jsonError } from "@/lib/http";
import { safeLog } from "@/lib/safe-log";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const manualCodeSchema = z.object({
  codeOrUrl: z.string().trim().min(1).max(4096),
  state: z.string().trim().max(512).optional(),
});

export async function POST(request: Request) {
  const url = new URL(request.url);

  try {
    const user = await requireApiUser();
    const input = manualCodeSchema.parse(await request.json());
    const parsed = parseAuthorizationCodeInput(input.codeOrUrl);
    const submittedState = manualOAuthStateForValidation({
      parsedState: parsed.state,
      explicitState: input.state,
    });
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("ebay_oauth_state")?.value;
    const config = getEbayConfig();
    const inputLooksLikeUrl = /^https?:\/\//.test(input.codeOrUrl.trim());
    const stateMatches = Boolean(
      submittedState && expectedState && submittedState === expectedState,
    );
    const canBypassStateMismatch = Boolean(
      parsed.code &&
        parsed.state &&
        (parsed.source === "url" || parsed.source === "query"),
    );

    safeLog("info", "ebay.oauth.manual_code.start", {
      path: url.pathname,
      inputSource: parsed.source,
      rawInputLength: input.codeOrUrl.length,
      inputLooksLikeUrl,
      codePresent: Boolean(parsed.code),
      codeLength: parsed.code?.length ?? 0,
      codeContainsWhitespace: Boolean(parsed.code && /\s/.test(parsed.code)),
      codeContainsPercentEscape: Boolean(parsed.code && /%[0-9a-f]{2}/i.test(parsed.code)),
      statePresent: Boolean(submittedState),
      stateLength: submittedState?.length ?? 0,
      stateSource: parsed.state ? parsed.source : input.state?.trim() ? "field" : "missing",
      pastedState: submittedState,
      expectedStatePresent: Boolean(expectedState),
      stateMatches,
      stateBypassEligible: canBypassStateMismatch,
      redirectUriUsed: config.ruName,
      tokenEndpoint: `${config.hosts.api}/identity/v1/oauth2/token`,
    });

    if (!parsed.code) {
      safeLog("warn", "ebay.oauth.manual_code.missing_code", {
        path: url.pathname,
        inputSource: parsed.source,
      });
      return jsonError("No authorization code was found.", 422);
    }

    if (!submittedState) {
      safeLog("warn", "ebay.oauth.manual_code.missing_state", {
        path: url.pathname,
        inputSource: parsed.source,
        codePresent: true,
      });
      return jsonError(missingManualOAuthStateMessage, 422);
    }

    if (submittedState && expectedState && submittedState !== expectedState) {
      safeLog("warn", "ebay.oauth.manual_code.invalid_state", {
        path: url.pathname,
        statePresent: true,
        expectedStatePresent: true,
        stateMatches: false,
        pastedState: submittedState,
        stateBypassEligible: canBypassStateMismatch,
      });

      if (!canBypassStateMismatch) {
        return jsonError("invalid_oauth_state", 400);
      }
    }

    if (canBypassStateMismatch && (!expectedState || !stateMatches)) {
      safeLog("warn", "ebay.oauth.manual_code.manual_state_bypass_used", {
        path: url.pathname,
        inputSource: parsed.source,
        pastedState: submittedState,
        cookieStateExists: Boolean(expectedState),
        stateMatches,
      });
    }

    if (!submittedState || !expectedState) {
      safeLog("warn", "ebay.oauth.manual_code.state_not_verified", {
        path: url.pathname,
        statePresent: Boolean(submittedState),
        expectedStatePresent: Boolean(expectedState),
      });
    }

    const result = await completeEbayOAuthConnection({
      user,
      code: parsed.code,
      path: url.pathname,
      logPrefix: "ebay.oauth.manual_code",
    });

    cookieStore.delete("ebay_oauth_state");
    safeLog("info", "ebay.oauth.manual_code.completed", {
      path: url.pathname,
      environment: result.environment,
      accountId: result.accountId,
    });

    return Response.json({
      connected: true,
      account: {
        id: result.accountId,
        environment: result.environment,
        username: result.username,
        ebayUserId: result.ebayUserId,
        existingAccountUpdated: result.existingAccountUpdated,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Check the authorization code input.", 422, error.flatten());
    }

    safeLog("error", "ebay.oauth.manual_code.failed", {
      path: url.pathname,
      message: asErrorMessage(error),
    });

    const details =
      error instanceof Error && "details" in error
        ? (error as Error & { details?: unknown }).details
        : undefined;

    return jsonError(asErrorMessage(error), 400, details);
  }
}
