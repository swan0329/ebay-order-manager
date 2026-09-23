import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { ensureEbayProductSalesHold } from "@/lib/ebay-sales-hold";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { productIds } = z.object({ productIds: z.array(z.string().min(1)).min(1).max(3) }).parse(await request.json());
    const results = [];
    for (const id of new Set(productIds)) results.push(await ensureEbayProductSalesHold(user.id, id));
    return Response.json({ results });
  } catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : error instanceof Error ? error.message : "판매 보류 확인 실패", error instanceof UnauthorizedError ? 401 : 422); }
}
