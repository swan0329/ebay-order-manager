import { describe, expect, it } from "vitest";
import { buildChannelPriceComparison } from "@/lib/channel-price-comparison";

const product = { sku: "SKU-1", productName: "Card", ebayCurrency: "USD" };

function listing(channel: "EBAY" | "SHOPIFY", price: number, status: string) {
  return {
    productId: "product-1",
    channel,
    externalId: `${channel}-id`,
    price,
    status,
    updatedAt: new Date("2026-08-26T00:00:00Z"),
    product,
  };
}

describe("buildChannelPriceComparison", () => {
  it("compares active listings without caring about status letter case", () => {
    const result = buildChannelPriceComparison([
      listing("EBAY", 15.7, "ACTIVE"),
      listing("SHOPIFY", 15.7, "active"),
    ]);

    expect(result.summary).toEqual({
      activeOnBoth: 1,
      equal: 1,
      different: 0,
      missingPrice: 0,
      inactiveExcluded: 0,
    });
  });

  it("does not compare an ended historical eBay price with an active Shopify price", () => {
    const result = buildChannelPriceComparison([
      listing("EBAY", 3.49, "ENDED"),
      listing("SHOPIFY", 15.7, "active"),
    ]);

    expect(result.summary.activeOnBoth).toBe(0);
    expect(result.summary.different).toBe(0);
    expect(result.summary.inactiveExcluded).toBe(1);
    expect(result.rows).toEqual([]);
  });
});
