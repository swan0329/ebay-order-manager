import { prisma } from "@/lib/prisma";
import { ensurePocamarketPurchaseJobs } from "@/lib/pocamarket-purchases";
import { jsonError } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Unauthorized", 401);
  await ensurePocamarketPurchaseJobs();
  const { id } = await context.params;
  const rows = await prisma.$queryRaw<Array<{ purchasedQuantity: number; requestedQuantity: number; status: string }>>`
    UPDATE "pocamarket_purchase_jobs" SET
      "purchased_quantity" = LEAST("requested_quantity", "purchased_quantity" + 1),
      "status" = CASE WHEN "purchased_quantity" + 1 >= "requested_quantity" THEN 'completed' ELSE 'queued' END,
      "completed_at" = CASE WHEN "purchased_quantity" + 1 >= "requested_quantity" THEN NOW() ELSE NULL END,
      "updated_at" = NOW()
    WHERE "id" = ${id} AND "user_id" = ${user.id} AND "status" = 'awaiting_confirmation'
    RETURNING "purchased_quantity" AS "purchasedQuantity", "requested_quantity" AS "requestedQuantity", "status"
  `;
  if (!rows.length) return jsonError("결제 확인 대기 중인 작업이 아닙니다.", 409);
  return Response.json({ ok: true, job: rows[0] });
}
