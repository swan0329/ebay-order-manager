import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { getProcurementSafetySummary, ensureProcurementRefreshQueue } from "@/lib/procurement-maintenance";
import { refreshProcurementProduct } from "@/lib/procurement-refresh";
import { procurementHoldReason } from "@/lib/procurement-freshness";

export const maxDuration = 300;
export async function GET() {
  try { await requireApiUser(); return Response.json(await getProcurementSafetySummary()); }
  catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : "조달 상태 조회 실패", error instanceof UnauthorizedError ? 401 : 503); }
}
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { skus } = z.object({ skus: z.array(z.string().trim().min(1)).min(1).max(10) }).parse(await request.json());
    const products = await prisma.product.findMany({ where: { sku: { in: skus } } });
    if (products.length !== new Set(skus).size) return jsonError("찾을 수 없는 상품번호가 있습니다.", 422);
    const results = [];
    for (const product of products) {
      const updated = await refreshProcurementProduct(product, user.id, true);
      results.push({ sku: updated.sku, priceKrw: updated.salePrice, availableCount: updated.pocamarketAvailableCount,
        syncedAt: updated.pocamarketSyncedAt, holdReason: procurementHoldReason(updated) });
    }
    after(() => ensureProcurementRefreshQueue(user.id).then(() => undefined).catch(() => { console.error("조달 재확인 예약은 정기 실행에서 재시도합니다."); }));
    return Response.json({ results, channelReflection: "판매채널 가격·수량 반영은 기존 변동 작업과 자동 대기열에서 별도 확인됩니다." });
  } catch (error) {
    return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : "조달 재확인에 실패했습니다. 최신화 내역을 확인해 주세요.", error instanceof UnauthorizedError ? 401 : 422);
  }
}
