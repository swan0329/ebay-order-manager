import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma";
import { listingQuantity } from "@/lib/listing-quantity";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { procurementHoldReason, procurementRefreshDue } from "@/lib/procurement-freshness";
import { fetchPocamarketProductState, loadPocamarketApiConfig } from "@/lib/pocamarket-api-collector";

const now = Date.now();
const product = { stockQuantity: 0, pocamarketAvailableCount: 2, pocamarketId: "182895",
  pocamarketSyncedAt: new Date(now - 5 * 86400000), pocamarketLastAttemptAt: new Date(now - 5 * 86400000),
  salePrice: new Prisma.Decimal(15000), finalListingPriceUsd: new Prisma.Decimal(32.9) };
const settings = { domesticShippingKrw: 3000, buyingAgencyFeeKrw: 4000, exchangeRateKrwPerUsd: 1459.45,
  targetMarginRate: 0.5, ebayFeeRate: 0.1325, advertisingRate: 0.18, roundingIncrementUsd: 0.1 };
describe("procurement sales protection", () => {
  it("holds stale source even with an old manual USD value or fallback quantity", () => {
    expect(resolveListingPriceUsd(product, settings)).toBeNull();
    expect(listingQuantity(product, 1)).toBe(0);
    expect(procurementRefreshDue(product, now)).toBe(true);
  });
  it("rejects a legacy USD value masquerading as KRW even when physical stock exists", () => {
    for (const price of [11.3, 160]) {
      const contaminated = { ...product, stockQuantity: 3, salePrice: new Prisma.Decimal(price),
        ebayLastSyncedPrice: new Prisma.Decimal(price), lastUploadedAt: new Date(now) };
      expect(resolveListingPriceUsd(contaminated, settings)).toBeNull();
      expect(listingQuantity(contaminated)).toBe(3);
      expect(procurementHoldReason(contaminated)).toContain("원가");
    }
  });
  it("preserves owned inventory while excluding stale procurement", () => {
    expect(listingQuantity({ ...product, stockQuantity: 3 })).toBe(3);
    expect(resolveListingPriceUsd({ ...product, stockQuantity: 3 }, settings)).not.toBeNull();
  });
  it("failed checks never refresh the success timestamp or release supply", () => {
    const failed = { ...product, pocamarketSyncedAt: new Date(now - 60000), pocamarketLastAttemptAt: new Date(now) };
    expect(procurementHoldReason(failed, now)).toContain("실패");
    expect(listingQuantity(failed)).toBe(0);
  });
  it("releases current quantity at the newly calculated price after successful recheck", () => {
    const fresh = { ...product, salePrice: new Prisma.Decimal(39000), pocamarketSyncedAt: new Date(now), pocamarketLastAttemptAt: new Date(now), pocamarketAvailableCount: 1 };
    expect(procurementHoldReason(fresh, now)).toBeNull();
    expect(listingQuantity(fresh)).toBe(1);
    expect(Number(resolveListingPriceUsd(fresh, settings)?.priceUsd)).toBe(68.8);
  });
  it("holds unknown source dates and rechecks at 6h before the 24h deadline", () => {
    expect(listingQuantity({ ...product, pocamarketAvailableCount: 0, pocamarketSyncedAt: new Date(), pocamarketLastAttemptAt: null }, 5)).toBe(0);
    expect(listingQuantity({ ...product, pocamarketSyncedAt: null })).toBe(0);
    const due = { ...product, pocamarketSyncedAt: new Date(now - 6 * 3600000), pocamarketLastAttemptAt: null };
    expect(procurementRefreshDue(due, now)).toBe(true);
    expect(procurementHoldReason(due, now)).toBeNull();
    expect(procurementHoldReason({ ...due, pocamarketSyncedAt: new Date(now - 24 * 3600000) }, now)).not.toBeNull();
  });
  it("does not offer expensive listings that the unchanged phone purchase cap rejects", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [
      { price: 15000, same_count: 1 }, { price: 18000, same_count: 2 },
      { price: 18001, same_count: 4 }, { price: 39000, same_count: 2 },
    ] })));
    const result = await fetchPocamarketProductState("182895", loadPocamarketApiConfig({}), { fetch: request });
    expect(result).toMatchObject({ price: 15000, availableCount: 3, isSoldOut: false });
  });
});
