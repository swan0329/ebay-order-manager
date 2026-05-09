import { describe, expect, it } from "vitest";
import {
  legacyListingReferenceFromOrderItemRaw,
  normalizeComparableTitle,
  resolveOrderItemProductMatch,
} from "../src/lib/product-matching";

const products = [
  {
    id: "p-3150",
    sku: "3150",
    productName: "Stray Kids I am NOT HYUNJIN",
    optionName: "HYUNJIN",
    category: "I am NOT",
    brand: "Stray Kids",
    memo: null,
  },
  {
    id: "p-3151",
    sku: "3151",
    productName: "Stray Kids I am WHO HYUNJIN",
    optionName: "HYUNJIN",
    category: "I am WHO",
    brand: "Stray Kids",
    memo: null,
  },
];

describe("product matching", () => {
  it("normalizes noisy eBay titles while keeping core words", () => {
    expect(
      normalizeComparableTitle(
        "  Official KPOP Stray-Kids / I am NOT (HYUNJIN) Photocard New ",
      ),
    ).toBe("stray kids i am not hyunjin");
  });

  it("matches SKU before any title matching", () => {
    expect(
      resolveOrderItemProductMatch(
        {
          id: "item-1",
          title: "Completely different title",
          sku: "3150",
          rawJson: {},
        },
        products,
      ),
    ).toMatchObject({
      product: { id: "p-3150" },
      matchedBy: "sku",
      matchScore: null,
    });
  });

  it("uses manual item and variation mappings when SKU is absent", () => {
    expect(
      resolveOrderItemProductMatch(
        {
          id: "item-1",
          title: "Unknown title",
          sku: null,
          rawJson: { legacyItemId: "123", legacyVariationId: "456" },
        },
        products,
        [
          {
            productId: "p-3150",
            ebayItemId: "123",
            ebayVariationId: "456",
            normalizedTitle: null,
            product: products[0],
          },
        ],
      ),
    ).toMatchObject({
      product: { id: "p-3150" },
      matchedBy: "item_variation",
    });
  });

  it("falls back to item id mapping when variation id is absent", () => {
    expect(
      resolveOrderItemProductMatch(
        {
          id: "item-1",
          title: "Unknown title",
          sku: null,
          rawJson: { legacyItemId: "123" },
        },
        products,
        [
          {
            productId: "p-3151",
            ebayItemId: "123",
            ebayVariationId: null,
            normalizedTitle: null,
            product: products[1],
          },
        ],
      ),
    ).toMatchObject({
      product: { id: "p-3151" },
      matchedBy: "item_id",
    });
  });

  it("auto matches a strong unique fuzzy title", () => {
    const result = resolveOrderItemProductMatch(
      {
        id: "item-1",
        title: "Official KPOP Stray Kids I am NOT Hyunjin Photocard",
        sku: null,
        rawJson: {},
      },
      products,
    );

    expect(result.product?.id).toBe("p-3150");
    expect(result.matchedBy).toBe("fuzzy_title");
    expect(result.matchScore).toBeGreaterThanOrEqual(0.82);
  });

  it("does not auto match ambiguous fuzzy candidates", () => {
    const result = resolveOrderItemProductMatch(
      {
        id: "item-1",
        title: "Stray Kids Hyunjin photocard",
        sku: null,
        rawJson: {},
      },
      products,
    );

    expect(result.product).toBeNull();
    expect(result.reason).toBe("ambiguous");
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("extracts eBay legacy ids from order item raw JSON", () => {
    expect(
      legacyListingReferenceFromOrderItemRaw({
        legacyItemId: "123",
        legacyVariationId: "456",
      }),
    ).toMatchObject({
      legacyItemId: "123",
      legacyVariationId: "456",
    });
  });
});
