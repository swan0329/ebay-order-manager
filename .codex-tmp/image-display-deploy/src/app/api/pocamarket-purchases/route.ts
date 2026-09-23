import { z } from "zod";
import {
  createPurchaseJobs,
  createProductPurchaseJob,
  ensurePocamarketPurchaseJobs,
} from "@/lib/pocamarket-purchases";
import { prisma } from "@/lib/prisma";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  orderId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  requestedQuantity: z.number().int().min(1).max(20).optional(),
}).refine((input) => Boolean(input.orderId) !== Boolean(input.productId));

export async function GET(request: Request) {
  let user;
  try {
    user = await requireApiUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    throw error;
  }
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return jsonError("주문번호가 필요합니다.", 400);
  await ensurePocamarketPurchaseJobs();
  const jobs = await prisma.$queryRaw<Array<{ id: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number; status: string; warningMessage: string | null }>>`
    SELECT "id", "product_number" AS "productNumber", "requested_quantity" AS "requestedQuantity", "purchased_quantity" AS "purchasedQuantity", "status", EXTRACT(EPOCH FROM "updated_at")::text AS "version", "warning_message" AS "warningMessage"
    FROM "pocamarket_purchase_jobs" WHERE "order_id" = ${orderId} AND "user_id" = ${user.id}
    ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
  `;
  return Response.json({ jobs });
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    return Response.json(
      input.productId
        ? await createProductPurchaseJob(
            user.id,
            input.productId,
            input.requestedQuantity ?? 1,
          )
        : await createPurchaseJobs(user.id, input.orderId!),
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("구매 요청 정보가 올바르지 않습니다.", 422);
    return jsonError(asErrorMessage(error), 400);
  }
}
