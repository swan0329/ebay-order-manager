import { beforeEach, expect, it, vi } from "vitest";
const find = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { pocamarketSyncItem: { findMany: find } } }));
import { procurementEvidenceMatches, withVerifiedProcurementEvidence } from "@/lib/procurement-evidence";
import { resolveListingPriceUsd } from "@/lib/listing-price";
const now = new Date();
const settings = { domesticShippingKrw:3000, buyingAgencyFeeKrw:4000, exchangeRateKrwPerUsd:1459.45, targetMarginRate:0.5, ebayFeeRate:0.1325, advertisingRate:0.18, roundingIncrementUsd:0.1 };
const product = { id: "p", sku: "296333", pocamarketId: "296333", salePrice: 25000, stockQuantity: 2,
  finalListingPriceUsd: 10.60, pocamarketAvailableCount: 1, pocamarketSyncedAt: now } as never;
const observation = { productId: "p", productNumber: "296333", observedPrice: 25000, observedAvailableCount: 1, availability: "AVAILABLE", observedAt: now, appliedAt: now };
beforeEach(() => find.mockReset().mockResolvedValue([observation]));
it("preserves independently corroborated KRW cost", async () => {
  expect((await withVerifiedProcurementEvidence([product]))[0]).toBe(product);
  expect(Number(resolveListingPriceUsd(product, settings)?.priceUsd)).toBe(47.9);
});
it.each([47.90, 10.60, 1000, 250])("holds overwritten cost %s even with fresh timestamp, owned stock and old manual USD", async cost => {
  const changed = { ...product as object, salePrice: cost } as never;
  const [checked] = await withVerifiedProcurementEvidence([changed]);
  expect(resolveListingPriceUsd(checked, settings)).toBeNull();
  expect(checked).toMatchObject({ stockQuantity: 2, finalListingPriceUsd: null, salePrice: null });
  expect(changed).toHaveProperty("salePrice", cost);
});
it.each([
  { productNumber: "other" }, { productId: "other" }, { observedAt: new Date(now.getTime() - 1) }, { appliedAt: null },
  { observedAvailableCount: 2 }, { availability: "FAILED" }, { observedPrice: null },
])("rejects a mismatched source record %j", change => {
  expect(procurementEvidenceMatches(product, { ...observation, ...change })).toBe(false);
});
it("missing observation cannot fall back to a previous manual dollar price", async () => {
  find.mockResolvedValue([]);
  expect(resolveListingPriceUsd((await withVerifiedProcurementEvidence([product]))[0], settings)).toBeNull();
});
it("does not require supplier evidence for a manually priced card without a source link", async () => {
  const manual = { ...product as object, pocamarketId: null } as never;
  expect((await withVerifiedProcurementEvidence([manual]))[0]).toBe(manual);
  expect(find).not.toHaveBeenCalled();
});
it("recognizes an independently observed sold-out state", () => {
  expect(procurementEvidenceMatches({ ...product as object, salePrice: null, pocamarketAvailableCount: 0 } as never,
    { ...observation, availability: "SOLD_OUT", observedPrice: 0, observedAvailableCount: 0 })).toBe(true);
});
it("accepts an observation applied later by a person using the observation timestamp", () => {
  expect(procurementEvidenceMatches(product, { ...observation, appliedAt: new Date(now.getTime() + 60000) })).toBe(true);
});
it("bounds database lookup sizes during a catalog audit", async () => {
  await withVerifiedProcurementEvidence(Array.from({ length: 401 }, (_, i) => ({ ...product as object, id: String(i) } as never)));
  expect(find.mock.calls.map(call => call[0].where.OR.length)).toEqual([200, 200, 1]);
});
