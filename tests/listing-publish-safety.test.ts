import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ product: vi.fn(), settings: vi.fn(), refresh: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findUniqueOrThrow: m.product }, pricingSettings: { findUnique: m.settings } } }));
vi.mock("@/lib/procurement-refresh", () => ({ refreshProcurementProduct: m.refresh }));
vi.mock("@/lib/services/ebayApiService", () => ({ ebayApiRequest: m.api }));
import { assertListingPublishValues } from "@/lib/listing-publish-safety";
import { publishProductListing } from "@/lib/services/listingService";
const settings = { domesticShippingKrw:3000, buyingAgencyFeeKrw:4000, exchangeRateKrwPerUsd:1459.45, targetMarginRate:0.5, ebayFeeRate:0.1325, advertisingRate:0.18, roundingIncrementUsd:0.1 };
const product = { id:"p",sku:"296333",pocamarketId:"296333",salePrice:25000,stockQuantity:0,pocamarketAvailableCount:1,pocamarketSyncedAt:new Date(),finalListingPriceUsd:null } as never;
const input = { sku:"296333",price:"47.90",quantity:1,currency:"USD" } as never;
beforeEach(() => { vi.clearAllMocks(); m.product.mockResolvedValue(product); m.refresh.mockImplementation(p=>p); m.settings.mockResolvedValue(settings); });
it("rejects the actual 10.60 incident price at the external write boundary", async () => {
  await expect(publishProductListing({} as never,product,{...input as object,price:"10.60"} as never)).rejects.toThrow("현재 원가");
  expect(m.api).not.toHaveBeenCalled();
});
it("allows current calculated price without rewriting the source cost", () => {
  expect(()=>assertListingPublishValues(product,input,settings)).not.toThrow();
  expect(product).toHaveProperty("salePrice",25000);
});
it.each([
  {currency:"KRW"}, {sku:"other"}, {quantity:2}, {price:"NaN"},
  {bestOfferEnabled:true,minimumOfferPrice:"10.60"},
  {bestOfferEnabled:true,minimumOfferPrice:"47.90",autoAcceptPrice:"10.60"},
])("rejects unsafe outgoing values %j", change => {
  expect(()=>assertListingPublishValues(product,{...input as object,...change} as never,settings)).toThrow();
});
it("re-reads the database so a stale queued product cannot bypass a cost increase", async () => {
  m.product.mockResolvedValue({...product as object,salePrice:30000});
  await expect(publishProductListing({} as never,product,input)).rejects.toThrow("현재 원가");
  expect(m.api).not.toHaveBeenCalled();
});
