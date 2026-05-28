import "server-only";

import { prisma } from "@/lib/prisma";

export type ProductStats = {
  totalCount: number;
  inStockCount: number;
  soldOutCount: number;
};

export async function getProductStats() {
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

  return row ?? { totalCount: 0, inStockCount: 0, soldOutCount: 0 };
}
