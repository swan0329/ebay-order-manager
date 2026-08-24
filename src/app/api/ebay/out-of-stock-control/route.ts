import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { enableEbayOutOfStockControl, getEbayOutOfStockControl } from "@/lib/services/ebayOutOfStockControl";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json({ enabled: await getEbayOutOfStockControl(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json().catch(() => null) as { confirmed?: boolean } | null;
    if (body?.confirmed !== true) return jsonError("계정 전체의 품절 유지 설정 변경 확인이 필요합니다.", 409);
    await enableEbayOutOfStockControl(user.id);
    return Response.json({ enabled: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
