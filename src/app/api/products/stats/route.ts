import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

type ProductStats = {
  totalCount: number;
  inStockCount: number;
  soldOutCount: number;
};

const cacheTtlMs = 15_000;
let statsCache: { expiresAt: number; value: ProductStats } | null = null;

export async function GET() {
  try {
    await requireApiUser();

    if (statsCache && statsCache.expiresAt > Date.now()) {
      return Response.json(statsCache.value);
    }

    const [row] = await prisma.$queryRaw<ProductStats[]>`
      SELECT
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (
          WHERE "stock_quantity" > 0
            AND "status" NOT IN ('inactive', 'sold_out')
        )::int AS "inStockCount",
        COUNT(*) FILTER (
          WHERE "stock_quantity" <= 0
            OR "status" = 'sold_out'
        )::int AS "soldOutCount"
      FROM "products"
    `;
    const value = row ?? { totalCount: 0, inStockCount: 0, soldOutCount: 0 };

    statsCache = {
      expiresAt: Date.now() + cacheTtlMs,
      value,
    };

    return Response.json(value);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
