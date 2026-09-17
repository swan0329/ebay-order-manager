import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { observedEbayAvailable, exactPublishedOffer, observedUnlinkedSingleAvailable } from "@/lib/ebay-sales-hold";
it("unlinked holds require an exact ID, absent SKU, no variations, and known quantity", () => {
  expect(observedUnlinkedSingleAvailable({ ItemID: "123", Quantity: "2", SellingStatus: { QuantitySold: "1" } }, "123")).toBe(1);
  for (const item of [{ ItemID: "other", Quantity: "1" }, { ItemID: "123", SKU: "known", Quantity: "1" }, { ItemID: "123", Variations: { Variation: { SKU: "option", Quantity: "1" } } }, { ItemID: "123" }]) {
    expect(() => observedUnlinkedSingleAvailable(item, "123")).toThrow();
  }
});
it("verifies the exact variation's available quantity rather than total quantity", () => {
  expect(observedEbayAvailable({ Variations: { Variation: [
    { SKU: "182895", Quantity: "2", SellingStatus: { QuantitySold: "1" } },
    { SKU: "sibling", Quantity: "10" },
  ] } }, "182895")).toEqual({ available: 1, variation: true });
  expect(observedEbayAvailable({ SKU: "single", Quantity: "3", SellingStatus: { QuantitySold: "3" } }, "single").available).toBe(0);
});
it("never guesses which SKU or parent to stop", () => {
  expect(() => observedEbayAvailable({ SKU: "another", Quantity: "1" }, "target")).toThrow();
  expect(() => observedEbayAvailable({ SKU: "target" }, "target")).toThrow();
});

it("does not treat the retained historical quantity of a completed listing as available stock", () => {
  expect(observedEbayAvailable({ SKU: "122587", Quantity: "1", SellingStatus: { QuantitySold: "0", ListingStatus: "Completed" } }, "122587")).toEqual({ available: 0, variation: false, ended: true });
  expect(() => observedEbayAvailable({ SKU: "other", Quantity: "1", SellingStatus: { ListingStatus: "Completed" } }, "122587")).toThrow();
});

it("requires the published offer to match both SKU and listing before changing inventory", () => {
  const offer = { offerId: "o", sku: "s", status: "PUBLISHED", listing: { listingId: "i" } };
  expect(exactPublishedOffer([offer], "s", "i")).toEqual(offer);
  expect(() => exactPublishedOffer([offer], "s", "other")).toThrow();
  expect(() => exactPublishedOffer([offer, offer], "s", "i")).toThrow();
  expect(() => exactPublishedOffer([{ ...offer, status: "UNPUBLISHED" }], "s", "i")).toThrow();
});
