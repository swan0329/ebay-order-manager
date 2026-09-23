import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensurePocamarketPurchaseJobs, validBridgeToken } from "@/lib/pocamarket-purchases";
import { jsonError } from "@/lib/http";

const schema = z.object({
  status: z.enum(["running", "awaiting_confirmation", "purchasing", "completed", "failed", "cancelled"]),
  foundUnitPrice: z.number().nonnegative().optional(),
  purchasedQuantity: z.number().int().nonnegative().optional(),
  marketOrderNumber: z.string().max(200).optional(),
  errorMessage: z.string().max(2000).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!validBridgeToken(request)) return jsonError("Unauthorized", 401);
  await ensurePocamarketPurchaseJobs();
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return jsonError("작업 결과가 올바르지 않습니다.", 422);
  const input = parsed.data;
  const current = await prisma.$queryRaw<Array<{ maxUnitPrice: string; foundUnitPrice: string | null; status: string; purchasedQuantity: number; requestedQuantity: number }>>`
    SELECT "max_unit_price"::text AS "maxUnitPrice", "found_unit_price"::text AS "foundUnitPrice", "status", "purchased_quantity" AS "purchasedQuantity", "requested_quantity" AS "requestedQuantity" FROM "pocamarket_purchase_jobs" WHERE "id" = ${id} LIMIT 1
  `;
  if (!current.length) return jsonError("작업을 찾을 수 없습니다.", 404);
  if (!["running", "purchasing"].includes(current[0].status)) return jsonError("이미 결제 확인 대기 또는 종료된 작업입니다. 주문 화면에서 상태를 확인해 주세요.", 409);
  if (input.purchasedQuantity !== undefined && input.purchasedQuantity !== current[0].purchasedQuantity) return jsonError("구매 완료 수량은 주문 화면의 결제 완료 확인으로만 변경할 수 있습니다.", 409);
  if (input.status === "completed") return jsonError("구매 완료는 주문 화면에서 확인해 주세요.", 409);
  const effectivePrice = input.foundUnitPrice ?? (current[0].foundUnitPrice === null ? undefined : Number(current[0].foundUnitPrice));
  if (["awaiting_confirmation", "purchasing", "completed"].includes(input.status) && effectivePrice === undefined) {
    return jsonError("가격 확인 전에는 결제를 진행할 수 없습니다.", 409);
  }
  const overLimit = effectivePrice !== undefined && effectivePrice > Number(current[0].maxUnitPrice);
  const status = overLimit ? "price_blocked" : input.status;
  const warning = overLimit ? `발견 가격 ${effectivePrice}원이 최대 허용가격 ${current[0].maxUnitPrice}원을 초과하여 구매하지 않았습니다.` : null;
  const changed = await prisma.$executeRaw`
    UPDATE "pocamarket_purchase_jobs" SET
      "status" = ${status}, "found_unit_price" = COALESCE(${input.foundUnitPrice ?? null}, "found_unit_price"),
      "purchased_quantity" = COALESCE(${input.purchasedQuantity ?? null}, "purchased_quantity"),
      "market_order_number" = COALESCE(${input.marketOrderNumber ?? null}, "market_order_number"),
      "error_message" = COALESCE(${input.errorMessage ?? null}, "error_message"),
      "warning_message" = COALESCE(${warning}, "warning_message"),
      "confirmation_requested_at" = CASE WHEN ${status} = 'awaiting_confirmation' THEN NOW() ELSE "confirmation_requested_at" END,
      "completed_at" = CASE WHEN ${status} IN ('completed','failed','cancelled','price_blocked') THEN NOW() ELSE "completed_at" END,
      "updated_at" = NOW()
    WHERE "id" = ${id} AND "status" = ${current[0].status} AND "purchased_quantity" = ${current[0].purchasedQuantity}
  `;
  if (!changed) return jsonError("다른 요청에서 구매 상태를 변경했습니다. 다시 확인해 주세요.", 409);
  return Response.json({ ok: true, status, blocked: overLimit, warning });
}
