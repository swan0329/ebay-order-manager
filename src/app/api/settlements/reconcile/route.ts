import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { reconcileSettlements } from "@/lib/services/settlementReconciliation";

const schema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { days } = schema.parse({ days: new URL(request.url).searchParams.get("days") ?? 30 });
    return Response.json(await reconcileSettlements(user.id, days));
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return jsonError(unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "정산을 조회하지 못했습니다.", unauthorized ? 401 : 400);
  }
}
