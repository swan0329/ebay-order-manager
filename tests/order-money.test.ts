import { describe, expect, it } from "vitest";
import { orderItemSale, orderMerchandiseTotal, soldBelowCurrentCost } from "../src/lib/order-money";
import { orderCardImageSources } from "../src/lib/order-images";
import { resolveListingPriceUsd } from "../src/lib/listing-price";
import { Prisma } from "../src/generated/prisma";

const usd = (value: string) => ({ value, currency: "USD" });
const shopUsd = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });

describe("historical order amounts", () => {
  it("keeps all four 10.60 card prices separate from the 9 USD shipping charge", () => {
    const sales = Array.from({ length: 4 }, (_, index) => orderItemSale({
      lineItemCost: usd("10.6"), total: usd(index === 0 ? "19.6" : "10.6"),
    }, 1, "EBAY"));
    expect(sales.every(sale => sale?.unitAmount === 10.6)).toBe(true);
    expect(orderMerchandiseTotal(sales, "USD")).toBe(42.4);
  });
  it("uses discounted line cost and divides quantities without multiplying the line total twice", () => {
    expect(orderItemSale({ lineItemCost: usd("30"), discountedLineItemCost: usd("24") }, 3, "EBAY"))
      .toEqual({ unitAmount: 8, lineAmount: 24, currency: "USD" });
    expect(orderItemSale({ lineItemCost: usd("10"), discountedLineItemCost: usd("0") }, 1, "EBAY")?.lineAmount).toBe(0);
  });
  it("does not invent prices from shipping-inclusive totals, missing values or mixed currencies", () => {
    expect(orderItemSale({ total: usd("19.6") }, 1, "EBAY")).toBeNull();
    expect(orderItemSale({ lineItemCost: usd("") }, 1, "EBAY")).toBeNull();
    expect(orderItemSale({ lineItemCost: usd("10") }, 0, "EBAY")).toBeNull();
    expect(orderMerchandiseTotal([null], "USD")).toBeNull();
    expect(orderMerchandiseTotal([{ lineAmount: 10, unitAmount: 10, currency: "EUR" }], "USD")).toBeNull();
  });
  it("deducts all Shopify allocations, including order-level discounts", () => {
    expect(orderItemSale({ originalTotalSet: shopUsd("30"), discountAllocations: [
      { allocatedAmountSet: shopUsd("3") }, { allocatedAmountSet: shopUsd("6") },
    ] }, 3, "SHOPIFY")).toEqual({ lineAmount: 21, unitAmount: 7, currency: "USD" });
    expect(orderItemSale({ originalTotalSet: shopUsd("30") }, 3, "SHOPIFY")).toBeNull();
  });
  it("flags current source cost only when a valid same-unit conversion is available", () => {
    const sale = { unitAmount: 10.6, lineAmount: 10.6, currency: "USD" };
    expect(soldBelowCurrentCost(sale, 25000, 1459.45)).toBe(true);
    expect(soldBelowCurrentCost(sale, null, 1459.45)).toBe(false);
    expect(soldBelowCurrentCost(sale, 25000, 0)).toBe(false);
    expect(soldBelowCurrentCost({ ...sale, currency: "EUR" }, 25000, 1459.45)).toBe(false);
  });
  it("prefers the matched SKU photo, keeps a sold-image fallback and removes duplicates", () => {
    expect(orderCardImageSources("https://example.com/card.jpg", { soldImageUrl: "https://example.com/group.jpg" }))
      .toEqual(["https://example.com/card.jpg", "https://example.com/group.jpg"]);
    expect(orderCardImageSources(null, { image: { url: "https://example.com/card.jpg" } }))
      .toEqual(["https://example.com/card.jpg"]);
    expect(orderCardImageSources("https://example.com/card.jpg", { imageUrl: "https://example.com/card.jpg" })).toHaveLength(1);
  });
});

it.each([47.9, 55.4, 32.9, 40.4])("rejects this incident's USD-as-KRW cost %s", cost => {
  expect(resolveListingPriceUsd({
    stockQuantity: 0, pocamarketId: "296333", salePrice: new Prisma.Decimal(cost),
    finalListingPriceUsd: null, pocamarketSyncedAt: new Date(),
  }, { domesticShippingKrw: 3000, buyingAgencyFeeKrw: 4000, exchangeRateKrwPerUsd: 1459.45,
    targetMarginRate: 0.5, ebayFeeRate: 0.1325, advertisingRate: 0.18 })).toBeNull();
});
