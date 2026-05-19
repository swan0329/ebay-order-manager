import { asErrorMessage, jsonError } from "@/lib/http";
import { productWhere } from "@/lib/products";
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

    const [totalCount, inStockCount, soldOutCount] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: productWhere({ stock: "in_stock" }) }),
      prisma.product.count({ where: productWhere({ stock: "sold_out" }) }),
    ]);
    const value = { totalCount, inStockCount, soldOutCount };

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
