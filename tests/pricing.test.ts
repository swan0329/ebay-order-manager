import { describe, expect, it } from "vitest";
import { calculateRecommendedPrice, validatePricingSettings } from "@/lib/pricing";

const base = {
  pocaPriceKrw: "10000", domesticShippingKrw: "3000", buyingAgencyFeeKrw: "1000",
  exchangeRateKrwPerUsd: "1400", targetMarginRate: "0.30",
  ebayFeeRate: "0.13", advertisingRate: "0.05",
  minimumSalePriceUsd: null, roundingIncrementUsd: "0.10",
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
  it("applies the global minimum after calculation", () => {
    const result = calculateRecommendedPrice({ ...base, pocaPriceKrw: "0", domesticShippingKrw: "0", buyingAgencyFeeKrw: "0", minimumSalePriceUsd: "4.99" });
    expect(result.recommendedPriceUsd.toFixed(2)).toBe("4.99");
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

describe("배송비·주문 고정비·판매세까지 반영한 계산", () => {
  const real = {
    ...base,
    pocaPriceKrw: "10000",
    domesticShippingKrw: "3000",
    buyingAgencyFeeKrw: "1000",
    exchangeRateKrwPerUsd: "1400",
    targetMarginRate: "0.30",
    ebayFeeRate: "0.136",
    internationalFeeRate: "0.0144",
    advertisingRate: "0.18",
    perOrderFeeUsd: "0.40",
    buyerShippingUsd: "9",
    salesTaxUpliftRate: "0.07",
    insertionFeeUsd: "0",
  };

  it("배송비에 붙는 수수료와 주문 고정비를 판매가에 얹는다", () => {
    const withShipping = calculateRecommendedPrice(real);
    const withoutShipping = calculateRecommendedPrice({
      ...real,
      buyerShippingUsd: "0",
      perOrderFeeUsd: "0",
    });
    expect(withShipping.recommendedPriceUsd.greaterThan(withoutShipping.recommendedPriceUsd)).toBe(
      true,
    );
  });

  it("목표 마진이 실제로 남는다", () => {
    const result = calculateRecommendedPrice(real);
    // 반올림 때문에 목표보다 조금 더 남는다. 모자라면 안 된다.
    expect(result.expectedNetMarginRate.toNumber()).toBeGreaterThanOrEqual(0.3);
    expect(result.expectedNetMarginRate.toNumber()).toBeLessThan(0.36);
  });

  it("수수료 기준은 판매가에 배송비와 판매세를 더한 금액이다", () => {
    const result = calculateRecommendedPrice(real);
    const expected = result.recommendedPriceUsd.plus(9).times(1.07);
    expect(result.feeBasisUsd.toFixed(4)).toBe(expected.toFixed(4));
  });

  it("등록수수료를 넣으면 그만큼 판매가가 올라간다", () => {
    const withInsertion = calculateRecommendedPrice({ ...real, insertionFeeUsd: "0.35" });
    const without = calculateRecommendedPrice(real);
    expect(withInsertion.recommendedPriceUsd.greaterThan(without.recommendedPriceUsd)).toBe(true);
  });

  it("수수료 합이 100%를 넘으면 거부한다", () => {
    expect(() =>
      calculateRecommendedPrice({ ...real, advertisingRate: "0.8", ebayFeeRate: "0.2" }),
    ).toThrow("100% 미만");
  });
});
