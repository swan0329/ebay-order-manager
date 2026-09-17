import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), evidence: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findUnique: m.find, update: m.update }, pocamarketSyncItem: { findMany: m.evidence } } }));
import { upsertProductFromListingInput } from "@/lib/services/inventoryService";
import { withVerifiedProcurementEvidence } from "@/lib/procurement-evidence";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { assertListingPublishValues } from "@/lib/listing-publish-safety";
const settings = { domesticShippingKrw:3000, buyingAgencyFeeKrw:4000, exchangeRateKrwPerUsd:1459.45, targetMarginRate:0.5, ebayFeeRate:0.1325, advertisingRate:0.18, roundingIncrementUsd:0.1 };
it.each([
  ["296333", 25000, "47.90"], ["284272", 30000, "55.40"],
  ["284806", 15000, "32.90"], ["287832", 20000, "40.40"],
])("registration then later repricing preserves the cost for incident card %s", async (sku, cost, price) => {
  const now = new Date();
  let stored = { id: String(sku), sku, salePrice: cost, stockQuantity: 0, pocamarketId: sku,
    finalListingPriceUsd: null, pocamarketSyncedAt: now, pocamarketAvailableCount: 1 };
  m.find.mockImplementation(async () => ({ ...stored }));
  m.update.mockImplementation(async ({data}) => (stored = { ...stored, ...data }));
  m.evidence.mockResolvedValue([{ productId: sku, productNumber: sku, observedPrice: cost, observedAvailableCount: 1, availability: "AVAILABLE", observedAt: now, appliedAt: now }]);
  const input = { sku, title: "Card", price, quantity: 1, currency: "USD", imageUrls: [] } as never;
  await upsertProductFromListingInput(input, "admin");
  expect(stored.salePrice).toBe(cost); expect(stored.stockQuantity).toBe(0);
  const [later] = await withVerifiedProcurementEvidence([stored as never]);
  expect(resolveListingPriceUsd(later, settings)?.priceUsd.toFixed(2)).toBe(price);
  expect(() => assertListingPublishValues(later, { ...input as object, price: "10.60" } as never, settings)).toThrow("현재 원가");
  // Reintroduce the old defect: the independent history must still stop it.
  stored.salePrice = Number(price);
  const [corrupted] = await withVerifiedProcurementEvidence([stored as never]);
  expect(resolveListingPriceUsd(corrupted, settings)).toBeNull();
});
