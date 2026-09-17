import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { ensureEbayProductSalesHold, ensureEbayUnlinkedSalesHold } from "@/lib/ebay-sales-hold";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = z.union([
      z.object({ productIds: z.array(z.string().min(1)).min(1).max(3) }).strict(),
      z.object({ unlinkedItemIds: z.array(z.string().regex(/^\d+$/)).min(1).max(3), confirmed: z.literal(true) }).strict(),
    ]).parse(await request.json());
    const results = [];
    if ("productIds" in input) {
      for (const id of new Set(input.productIds)) results.push(await ensureEbayProductSalesHold(user.id, id));
    } else {
      for (const id of new Set(input.unlinkedItemIds)) results.push(await ensureEbayUnlinkedSalesHold(user.id, id));
    }
    return Response.json({ results });
  } catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : error instanceof Error ? error.message : "판매 보류 확인 실패", error instanceof UnauthorizedError ? 401 : 422); }
}
