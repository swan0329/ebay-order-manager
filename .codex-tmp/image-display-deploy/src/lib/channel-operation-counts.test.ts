import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOperationalProductIds: vi.fn(),
  getEbayFeedOperationTargets: vi.fn(),
  getShopifyAutomaticOperationProductIds: vi.fn(),
  findMany: vi.fn(),
  getEbayVariationMembershipByProductId: vi.fn(),
}));

vi.mock("@/lib/product-operations", () => ({
  getOperationalProductIds: mocks.getOperationalProductIds,
}));
vi.mock("@/lib/ebay-feed-operations", () => ({
  getEbayFeedOperationTargets: mocks.getEbayFeedOperationTargets,
}));
vi.mock("@/lib/channel-publish-jobs", () => ({
  getShopifyAutomaticOperationProductIds: mocks.getShopifyAutomaticOperationProductIds,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/variation-listing-products", () => ({
  getEbayVariationMembershipByProductId: mocks.getEbayVariationMembershipByProductId,
}));

import { getChannelOperationCounts } from "@/lib/channel-operation-counts";

describe("channel operation counts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getOperationalProductIds
      .mockResolvedValueOnce(["e1", "e2", "e3"])
      .mockResolvedValueOnce(["s1", "s2"]);
    mocks.getEbayVariationMembershipByProductId.mockResolvedValue(new Map([["e2", "item-1"]]));
    mocks.findMany
      .mockResolvedValueOnce([
        { finalListingPriceUsd: 10 },
        { finalListingPriceUsd: 20 },
        { finalListingPriceUsd: null },
      ])
      .mockResolvedValueOnce([
        { finalListingPriceUsd: 10 },
        { finalListingPriceUsd: null },
      ]);
    mocks.getEbayFeedOperationTargets
      .mockResolvedValueOnce([{ productId: "e1" }, { productId: "e2" }])
      .mockResolvedValueOnce([{ productId: "e3" }]);
    mocks.getShopifyAutomaticOperationProductIds
      .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }, { id: "s3" }])
      .mockResolvedValueOnce([]);
  });

  it("returns actual registration, revision, and ending target counts per channel", async () => {
    await expect(getChannelOperationCounts("user-1")).resolves.toEqual({
      ebay: {
        register: 2,
        registrationBreakdown: { readyCount: 3, linkedExcludedCount: 0, priceMissingCount: 1 },
        revise: 2,
        end: 1,
        revisePrice: 0,
        reviseQuantity: 0,
        reviseUnverified: 0,
      },
      shopify: { register: 1, registrationBreakdown: { readyCount: 2, linkedExcludedCount: 0, priceMissingCount: 1 }, revise: 3, end: 0 },
    });
  });

  it("handles a membership failure immediately while other DB reads are still pending", async () => {
    let release!: (ids: string[]) => void;
    const blocked = new Promise<string[]>((resolve) => { release = resolve; });
    mocks.getOperationalProductIds.mockReset().mockReturnValue(blocked);
    mocks.getEbayVariationMembershipByProductId.mockRejectedValue(new Error("connection timeout"));
    try {
      await expect(getChannelOperationCounts("failed-user")).rejects.toThrow("connection timeout");
      expect(mocks.getEbayFeedOperationTargets).not.toHaveBeenCalled();
    } finally {
      release([]);
    }
  });

  it("does not duplicate DB work for overlapping requests from the same user", async () => {
    const [first, second] = await Promise.all([
      getChannelOperationCounts("same-user"), getChannelOperationCounts("same-user"),
    ]);
    expect(first).toEqual(second);
    expect(mocks.getEbayVariationMembershipByProductId).toHaveBeenCalledTimes(1);
    expect(mocks.getOperationalProductIds).toHaveBeenCalledTimes(2);
  });
});
