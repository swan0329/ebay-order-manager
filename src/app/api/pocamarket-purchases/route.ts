import { z } from "zod";
import { createPurchaseJobs, ensurePocamarketPurchaseJobs } from "@/lib/pocamarket-purchases";
import { prisma } from "@/lib/prisma";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { readBridgeStatus } from "@/lib/pocamarket-bridge-status";

const schema = z.object({ orderId: z.string().min(1) });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Unauthorized", 401);
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return jsonError("주문번호가 필요합니다.", 400);
  await ensurePocamarketPurchaseJobs();
  const jobs = await prisma.$queryRaw<Array<{ id: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number; status: string; warningMessage: string | null }>>`
    SELECT "id", "product_number" AS "productNumber", "requested_quantity" AS "requestedQuantity", "purchased_quantity" AS "purchasedQuantity", "status", "warning_message" AS "warningMessage"
    FROM "pocamarket_purchase_jobs" WHERE "order_id" = ${orderId} AND "user_id" = ${user.id}
    ORDER BY "created_at" DESC
  `;
  // 화면이 이미 5초마다 이 응답을 받아 가므로, 브리지 상태도 같이 실어 보낸다.
  return Response.json({ jobs, bridge: await readBridgeStatus() });
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Unauthorized", 401);
    const input = schema.parse(await request.json());
    return Response.json(await createPurchaseJobs(user.id, input.orderId));
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError("주문 정보가 올바르지 않습니다.", 422);
    return jsonError(asErrorMessage(error), 400);
  }
}
