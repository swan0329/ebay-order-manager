import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { EbayApiError, getOrdersFromEbay, getValidAccessToken } from "@/lib/ebay";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

function isReauthError(error: unknown) {
  if (!(error instanceof EbayApiError)) {
    return false;
  }

  if (error.status === 401 || error.status === 403) {
    return true;
  }

  const body = error.body;
  const errorCode =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).error
      : undefined;

  return errorCode === "invalid_grant" || errorCode === "invalid_scope";
}

export async function GET() {
  try {
    const user = await requireApiUser();
    const environment = currentEbayEnvironment();
    const account = await prisma.ebayAccount.findFirst({
      where: { userId: user.id, environment },
      orderBy: { updatedAt: "desc" },
    });

    if (!account) {
      return Response.json({
        ok: false,
        reason: "not_connected",
        message: "연결된 eBay 계정이 없습니다. eBay 계정을 연결해 주세요.",
      });
    }

    // Force a token refresh: this is the real failure point when a connection
    // looks "connected" in the DB but the refresh token is expired or revoked.
    await getValidAccessToken(account, true);
    // Confirm the token actually works against the Fulfillment API.
    await getOrdersFromEbay(account, {}, 1, 0);

    return Response.json({
      ok: true,
      message: "eBay 연결이 정상입니다. 주문을 불러올 수 있습니다.",
      account: {
        username: account.username ?? account.ebayUserId ?? null,
        environment: account.environment,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    const needsReauth = isReauthError(error);

    safeLog("warn", "ebay.connection_status.failed", {
      status: error instanceof EbayApiError ? error.status : undefined,
      needsReauth,
      message: asErrorMessage(error),
    });

    return Response.json({
      ok: false,
      reason: needsReauth ? "reauth" : "error",
      message: needsReauth
        ? "eBay 연결이 만료되었습니다. 아래 'Fresh eBay Connect'로 다시 연결해 주세요."
        : `eBay 연결 확인 중 오류가 발생했습니다: ${asErrorMessage(error)}`,
    });
  }
}
