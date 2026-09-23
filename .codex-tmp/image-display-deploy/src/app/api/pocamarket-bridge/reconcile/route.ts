import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensurePocamarketPurchaseJobs, validBridgeToken } from "@/lib/pocamarket-purchases";
import { jsonError } from "@/lib/http";

const schema = z.object({
  productNumber: z.string().min(1).max(100),
  deviceSerial: z.string().min(1).max(100),
  paidUnitPrice: z.number().positive(),
});

export async function POST(request: Request) {
  if (!validBridgeToken(request)) return jsonError("Unauthorized", 401);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return jsonError("완료 정보가 올바르지 않습니다.", 422);
  await ensurePocamarketPurchaseJobs();
  const input = parsed.data;
  const rows = await prisma.$queryRaw<Array<{ id: string; purchasedQuantity: number; requestedQuantity: number; status: string }>>`
    WITH target AS (
      SELECT "id" FROM "pocamarket_purchase_jobs"
      WHERE "product_number" = ${input.productNumber}
        AND "device_serial" = ${input.deviceSerial}
        AND "created_at" >= NOW() - INTERVAL '1 hour'
        AND "status" <> 'completed'
      ORDER BY "created_at" DESC LIMIT 1
      FOR UPDATE
    )
    UPDATE "pocamarket_purchase_jobs" j SET
      "purchased_quantity" = LEAST(j."requested_quantity", j."purchased_quantity" + 1),
      "found_unit_price" = ${input.paidUnitPrice},
      "status" = CASE WHEN j."purchased_quantity" + 1 >= j."requested_quantity" THEN 'completed' ELSE 'queued' END,
      "error_message" = NULL,
      "completed_at" = CASE WHEN j."purchased_quantity" + 1 >= j."requested_quantity" THEN NOW() ELSE NULL END,
      "updated_at" = NOW()
    FROM target WHERE j."id" = target."id"
    RETURNING j."id", j."purchased_quantity" AS "purchasedQuantity", j."requested_quantity" AS "requestedQuantity", j."status"
  `;
  if (!rows.length) return jsonError("정정할 최근 구매 작업을 찾지 못했습니다.", 404);
  return Response.json({ ok: true, job: rows[0] });
}
