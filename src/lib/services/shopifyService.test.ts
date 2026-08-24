import { describe, expect, it } from "vitest";
import { buildShopifyVariationVariants } from "@/lib/shopify-variation-pricing";

describe("buildShopifyVariationVariants", () => {
  it("keeps a different price for every option SKU", () => {
    const variants = buildShopifyVariationVariants([
      { sku: "CARD-A", optionName: "A", priceUsd: "4.90" },
      { sku: "CARD-B", optionName: "B", priceUsd: "12.30" },
    ]);

    expect(variants.map(({ sku, price }) => ({ sku, price }))).toEqual([
      { sku: "CARD-A", price: "4.90" },
      { sku: "CARD-B", price: "12.30" },
    ]);
  });
});
