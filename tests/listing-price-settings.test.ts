import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { calculateRecommendedPrice, pricingInputsFromSettings } from "@/lib/pricing";

// 채널로 나가는 가격은 설정의 모든 수수료 항목을 반영해야 한다. 한 항목이라도
// 빠지면 설정 화면에서 본 값보다 싸게 등록된다.
const settings = {
  domesticShippingKrw: "0",
  buyingAgencyFeeKrw: "0",
  exchangeRateKrwPerUsd: "1390",
  targetMarginRate: "0.30",
  ebayFeeRate: "0.136",
  advertisingRate: "0",
  internationalFeeRate: "0.0144",
  perOrderFeeUsd: "0.40",
  buyerShippingUsd: "3.00",
  salesTaxUpliftRate: "0.07",
  insertionFeeUsd: "0.35",
  minimumSalePriceUsd: null,
  roundingIncrementUsd: "0.10",
};

const product = {
  salePrice: new Prisma.Decimal(10000),
  finalListingPriceUsd: null,
  stockQuantity: 3,
  pocamarketId: null,
  pocamarketSyncedAt: null,
  pocamarketLastAttemptAt: null,
};

describe("resolveListingPriceUsd", () => {
  it("설정 화면의 계산식과 똑같은 가격을 낸다", () => {
    const expected = calculateRecommendedPrice(pricingInputsFromSettings(settings, "10000"));
    const resolved = resolveListingPriceUsd(product, settings);
    expect(resolved?.source).toBe("pocamarket");
    expect(resolved?.priceUsd.toFixed(2)).toBe(expected.recommendedPriceUsd.toFixed(2));
  });

  // 항목별로 하나씩 0으로 되돌려, 빠뜨리면 가격이 실제로 내려가는지 확인한다.
  const feeFields = [
    "internationalFeeRate",
    "perOrderFeeUsd",
    "buyerShippingUsd",
    "salesTaxUpliftRate",
    "insertionFeeUsd",
  ] as const;

  for (const field of feeFields) {
    it(`${field}를 반영한다`, () => {
      const withFee = resolveListingPriceUsd(product, settings)!.priceUsd;
      const withoutFee = resolveListingPriceUsd(product, { ...settings, [field]: "0" })!.priceUsd;
      expect(withFee.greaterThan(withoutFee)).toBe(true);
    });
  }

  it("최소 판매가는 계산가보다 높을 때만 올린다", () => {
    const high = resolveListingPriceUsd(product, { ...settings, minimumSalePriceUsd: "99" });
    expect(high?.priceUsd.toFixed(2)).toBe("99.00");
    const low = resolveListingPriceUsd(product, { ...settings, minimumSalePriceUsd: "1" });
    expect(low?.priceUsd.toFixed(2)).toBe(
      resolveListingPriceUsd(product, settings)!.priceUsd.toFixed(2),
    );
  });

  it("포카마켓 가격이 없으면 승인된 직접입력 USD를 쓴다", () => {
    const manual = resolveListingPriceUsd(
      { ...product, salePrice: null, finalListingPriceUsd: new Prisma.Decimal("12.34") },
      settings,
    );
    expect(manual).toEqual({ priceUsd: expect.anything(), source: "manual_usd" });
    expect(manual?.priceUsd.toFixed(2)).toBe("12.34");
  });
});

describe("pricingInputsFromSettings", () => {
  it("설정의 수수료 항목을 하나도 빠뜨리지 않는다", () => {
    const inputs = pricingInputsFromSettings(settings, "10000");
    for (const field of [
      "internationalFeeRate",
      "perOrderFeeUsd",
      "buyerShippingUsd",
      "salesTaxUpliftRate",
      "insertionFeeUsd",
    ] as const) {
      expect(inputs[field], field).toBe(settings[field]);
    }
  });
});
