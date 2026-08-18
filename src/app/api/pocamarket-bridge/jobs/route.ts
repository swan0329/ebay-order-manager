import { prisma } from "@/lib/prisma";
import { ensurePocamarketPurchaseJobs, validBridgeToken } from "@/lib/pocamarket-purchases";
import { jsonError } from "@/lib/http";
import { recordBridgeHeartbeat } from "@/lib/pocamarket-bridge-status";

export async function GET(request: Request) {
  if (!validBridgeToken(request)) return jsonError("Unauthorized", 401);
  await ensurePocamarketPurchaseJobs();
  const deviceSerial = new URL(request.url).searchParams.get("device")?.slice(0, 100) || null;
  // 작업이 없을 때도 브리지가 살아 있다는 사실은 남긴다. 주문 화면은 이 시각으로
  // "휴대폰 연결 대기"가 정상 대기인지 브리지가 꺼진 것인지 구분한다.
  await recordBridgeHeartbeat(deviceSerial);
  const rows = await prisma.$queryRaw<Array<{
    id: string; productNumber: string; requestedQuantity: number;
    referenceUnitPrice: string; maxUnitPrice: string;
  }>>`
    WITH next_job AS (
      SELECT "id" FROM "pocamarket_purchase_jobs"
      WHERE ("status" = 'running' AND "device_serial" = ${deviceSerial})
         OR "status" = 'queued'
      ORDER BY CASE WHEN "status" = 'running' THEN 0 ELSE 1 END, "created_at" ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "pocamarket_purchase_jobs" j
    SET "status" = 'running', "started_at" = COALESCE(j."started_at", NOW()), "updated_at" = NOW(), "device_serial" = ${deviceSerial}
    FROM next_job WHERE j."id" = next_job."id"
    RETURNING j."id", j."product_number" AS "productNumber", j."requested_quantity" AS "requestedQuantity",
              j."reference_unit_price"::text AS "referenceUnitPrice", j."max_unit_price"::text AS "maxUnitPrice"
  `;
  return Response.json({ job: rows[0] ?? null });
}
