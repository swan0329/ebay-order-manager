import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: query } }));
import { getProductStats } from "@/lib/product-stats";

describe("inventory overview counts", () => {
  beforeEach(() => query.mockReset());
  it("includes listed price-missing products and counts owned stock without requiring images", async () => {
    query.mockResolvedValue([{ totalCount: 10, ownStockCount: 4, inStockCount: 2, priceMissingCount: 3 }]);
    const stats = await getProductStats("EBAY");
    expect(stats.ownStockCount).toBe(4);
    const [strings, ...values] = query.mock.calls[0];
    const sql = strings.reduce((out: string, part: string, i: number) => out + part + (values[i]?.sql ?? ""), "");
    expect(sql).toContain('COUNT(*) FILTER (WHERE "stock_quantity" > 0)::int AS "ownStockCount"');
    const priceClause = sql.match(/COUNT\(\*\) FILTER \(\s*WHERE[^;]*?\)::int AS "priceMissingCount"/g)?.at(-1)?.split('COUNT(*) FILTER (').at(-1);
    expect(priceClause).toContain('"final_listing_price_usd"');
    expect(priceClause).not.toContain('"isRegistered"');
  });
  it("provides explicit zeros for the overview when the database returns no row", async () => {
    query.mockResolvedValue([]);
    const stats = await getProductStats("SHOPIFY");
    expect(stats).toMatchObject({ totalCount: 0, ownStockCount: 0, inStockCount: 0, imagePendingCount: 0, priceMissingCount: 0, reviewCount: 0 });
  });
});
