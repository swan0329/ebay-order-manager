import { describe, expect, it } from "vitest";
import { calculateRecommendedPrice, validatePricingSettings } from "@/lib/pricing";

const base = {
  pocaPriceKrw: "10000", domesticShippingKrw: "3000", buyingAgencyFeeKrw: "1000",
  exchangeRateKrwPerUsd: "1400", targetMarginRate: "0.30",
  ebayFeeRate: "0.13", advertisingRate: "0.05",
  roundingIncrementUsd: "0.10",
};

describe("PocaMarket cost based eBay recommendation", () => {
  it("uses the formula and rounds upward to the next $0.10", () => {
    const result = calculateRecommendedPrice(base);
    expect(result.totalCostKrw.toString()).toBe("14000");
    expect(result.costUsd.toString()).toBe("10");
    expect(result.rawRecommendedPriceUsd.toDecimalPlaces(6).toString()).toBe("15.853659");
    expect(result.recommendedPriceUsd.toFixed(2)).toBe("15.90");
    expect(result.expectedNetMarginUsd.toFixed(2)).toBe("3.04");
  });
  it("ignores a legacy minimum sale price value", () => {
    const legacyInput = { ...base, minimumSalePriceUsd: "999.00" };
    const result = calculateRecommendedPrice(legacyInput);
    expect(result.recommendedPriceUsd.toFixed(2)).toBe("15.90");
  });
  it("rejects a zero exchange rate", () => {
    expect(() => calculateRecommendedPrice({ ...base, exchangeRateKrwPerUsd: "0" })).toThrow("환율은 0보다 커야");
  });
  it("rejects fee and advertising rates totaling 100% or more", () => {
    expect(() => calculateRecommendedPrice({ ...base, ebayFeeRate: "0.95", advertisingRate: "0.05" })).toThrow("100% 미만");
  });
  it("rejects negative costs and rates", () => {
    expect(() => validatePricingSettings({ ...base, domesticShippingKrw: "-1" })).toThrow("0 이상");
  });
});
