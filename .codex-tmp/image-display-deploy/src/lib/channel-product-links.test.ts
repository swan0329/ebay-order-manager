import { describe, expect, it } from "vitest";
import {
  ebayListingUrl,
  normalizeShopifyStoreHandle,
  shopifyAdminProductUrl,
} from "./channel-product-links";

describe("channel product links", () => {
  it("builds an eBay item URL only from a numeric item id", () => {
    expect(ebayListingUrl("157983735111")).toBe(
      "https://www.ebay.com/itm/157983735111",
    );
    expect(ebayListingUrl("not-an-item")).toBeNull();
  });

  it("removes a BOM and domain suffix from a Shopify store domain", () => {
    expect(normalizeShopifyStoreHandle("\uFEFFq5tvjt-ub.myshopify.com")).toBe(
      "q5tvjt-ub",
    );
    expect(normalizeShopifyStoreHandle("https://q5tvjt-ub.myshopify.com/"))
      .toBe("q5tvjt-ub");
  });

  it("accepts Shopify legacy and GraphQL product ids", () => {
    const expected =
      "https://admin.shopify.com/store/q5tvjt-ub/products/15244960891248";
    expect(
      shopifyAdminProductUrl(
        "\uFEFFq5tvjt-ub.myshopify.com",
        "15244960891248",
      ),
    ).toBe(expected);
    expect(
      shopifyAdminProductUrl(
        "q5tvjt-ub.myshopify.com",
        "gid://shopify/Product/15244960891248",
      ),
    ).toBe(expected);
  });
});
