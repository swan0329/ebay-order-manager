import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getShopifyVariantCardThemeStatus, installShopifyVariantCardTheme } from "@/lib/services/shopifyVariantCardTheme";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json(await getShopifyVariantCardThemeStatus());
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const body = await request.json().catch(() => null) as { confirmed?: boolean } | null;
    if (body?.confirmed !== true) return jsonError("현재 공개 Shopify 테마 변경 확인이 필요합니다.", 409);
    return Response.json(await installShopifyVariantCardTheme());
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
