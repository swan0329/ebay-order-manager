import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ ids: vi.fn(), products: vi.fn() }));
vi.mock("@/lib/product-operations", () => ({ getOperationalProductIds: mocks.ids }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: mocks.products } } }));
import { getRegistrationCandidates } from "@/lib/channel-registration-candidates";

describe("registration candidate reconciliation", () => {
  beforeEach(() => vi.resetAllMocks());
  it("partitions broad SKU candidates without double counting linked and price exclusions, independent of page limit", async () => {
    mocks.ids.mockResolvedValue(["a", "b", "c", "linked1", "linked2"]);
    mocks.products.mockResolvedValue([
      { id: "a", sku: "001", salePrice: 12000, finalListingPriceUsd: null },
      { id: "b", sku: "002", salePrice: null, finalListingPriceUsd: 15 },
      { id: "c", sku: "003", salePrice: 0, finalListingPriceUsd: null },
    ]);
    const result = await getRegistrationCandidates("EBAY", 1);
    expect(result.products.map(p => p.id)).toEqual(["a"]);
    expect(result.eligibleCount).toBe(2);
    expect(result.breakdown).toEqual({ readyCount: 5, linkedExcludedCount: 2, priceMissingCount: 1 });
    expect(result.eligibleCount + result.breakdown.linkedExcludedCount + result.breakdown.priceMissingCount).toBe(result.breakdown.readyCount);
    expect(mocks.products.mock.calls[0][0].where.OR).toEqual([{ ebayItemId: null }, { ebayItemId: "" }]);
  });
  it("continues to include Shopify publication-pending recovery", async () => {
    mocks.ids.mockResolvedValue(["pending"]);
    mocks.products.mockResolvedValue([{ id: "pending", sku: "123", salePrice: 8000, finalListingPriceUsd: null }]);
    const result = await getRegistrationCandidates("SHOPIFY", 1);
    expect(result.eligibleCount).toBe(1);
    expect(result.breakdown.linkedExcludedCount).toBe(0);
    expect(mocks.products.mock.calls[0][0].where.OR).toContainEqual({ shopifyStatus: { equals: "publication_pending", mode: "insensitive" } });
  });
  it("returns an explicit zero breakdown without another DB read when no candidates exist", async () => {
    mocks.ids.mockResolvedValue([]);
    expect(await getRegistrationCandidates("EBAY", 1)).toEqual({ products: [], eligibleCount: 0, breakdown: { readyCount: 0, linkedExcludedCount: 0, priceMissingCount: 0 } });
    expect(mocks.products).not.toHaveBeenCalled();
  });
});
