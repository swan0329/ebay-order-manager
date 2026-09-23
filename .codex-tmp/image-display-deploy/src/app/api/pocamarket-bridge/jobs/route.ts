import { prisma } from "@/lib/prisma";
import { ensurePocamarketPurchaseJobs, validBridgeToken } from "@/lib/pocamarket-purchases";
import { jsonError } from "@/lib/http";

export async function GET(request: Request) {
  if (!validBridgeToken(request)) return jsonError("Unauthorized", 401);
  await ensurePocamarketPurchaseJobs();
  const deviceSerial = new URL(request.url).searchParams.get("device")?.slice(0, 100) || null;
  const rows = await prisma.$queryRaw<Array<{
    id: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number;
    referenceUnitPrice: string; maxUnitPrice: string;
  }>>`
    WITH next_job AS (
      SELECT "id" FROM "pocamarket_purchase_jobs"
      WHERE "status" = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM "pocamarket_purchase_jobs"
          WHERE "status" IN ('running', 'purchasing', 'awaiting_confirmation')
        )
      ORDER BY "created_at" ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "pocamarket_purchase_jobs" j
    SET "status" = 'running', "started_at" = COALESCE(j."started_at", NOW()), "updated_at" = NOW(), "device_serial" = ${deviceSerial}
    FROM next_job WHERE j."id" = next_job."id"
    RETURNING j."id", j."product_number" AS "productNumber", j."requested_quantity" AS "requestedQuantity",
              j."purchased_quantity" AS "purchasedQuantity", j."reference_unit_price"::text AS "referenceUnitPrice", j."max_unit_price"::text AS "maxUnitPrice"
  `;
  return Response.json({ job: rows[0] ?? null });
}
