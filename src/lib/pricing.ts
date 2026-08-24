import { Prisma } from "@/generated/prisma";

export type PricingInputs = {
  pocaPriceKrw: Prisma.Decimal.Value;
  domesticShippingKrw: Prisma.Decimal.Value;
  buyingAgencyFeeKrw: Prisma.Decimal.Value;
  exchangeRateKrwPerUsd: Prisma.Decimal.Value;
  targetMarginRate: Prisma.Decimal.Value;
  ebayFeeRate: Prisma.Decimal.Value;
  advertisingRate: Prisma.Decimal.Value;
  roundingIncrementUsd?: Prisma.Decimal.Value;
};

export function validatePricingSettings(input: Omit<PricingInputs, "pocaPriceKrw">) {
  const values = [
    input.domesticShippingKrw,
    input.buyingAgencyFeeKrw,
    input.targetMarginRate,
    input.ebayFeeRate,
    input.advertisingRate,
  ].map((value) => new Prisma.Decimal(value));
  if (values.some((value) => value.isNegative())) {
    throw new Error("비용과 비율은 0 이상이어야 합니다.");
  }
  const exchangeRate = new Prisma.Decimal(input.exchangeRateKrwPerUsd);
  if (exchangeRate.lessThanOrEqualTo(0)) {
    throw new Error("환율은 0보다 커야 합니다.");
  }
  const feeTotal = new Prisma.Decimal(input.ebayFeeRate).plus(input.advertisingRate);
  if (feeTotal.greaterThanOrEqualTo(1)) {
    throw new Error("eBay 판매수수료율과 광고율의 합은 100% 미만이어야 합니다.");
  }
  const increment = new Prisma.Decimal(input.roundingIncrementUsd ?? "0.10");
  if (increment.lessThanOrEqualTo(0)) {
    throw new Error("반올림 단위는 0보다 커야 합니다.");
  }
}

export function calculateRecommendedPrice(input: PricingInputs) {
  validatePricingSettings(input);
  const pocaPriceKrw = new Prisma.Decimal(input.pocaPriceKrw);
  if (pocaPriceKrw.isNegative()) {
    throw new Error("포카마켓 상품가는 0 이상이어야 합니다.");
  }

  const totalCostKrw = pocaPriceKrw
    .plus(input.domesticShippingKrw)
    .plus(input.buyingAgencyFeeKrw);
  const costUsd = totalCostKrw.div(input.exchangeRateKrwPerUsd);
  const feeTotal = new Prisma.Decimal(input.ebayFeeRate).plus(input.advertisingRate);
  const rawRecommendedPriceUsd = costUsd
    .times(new Prisma.Decimal(1).plus(input.targetMarginRate))
    .div(new Prisma.Decimal(1).minus(feeTotal));
  const increment = new Prisma.Decimal(input.roundingIncrementUsd ?? "0.10");
  const recommendedPriceUsd = rawRecommendedPriceUsd.div(increment).ceil().times(increment);
  const expectedProceedsUsd = recommendedPriceUsd.times(
    new Prisma.Decimal(1).minus(feeTotal),
  );
  const expectedNetMarginUsd = expectedProceedsUsd.minus(costUsd);
  const expectedNetMarginRate = costUsd.isZero()
    ? new Prisma.Decimal(0)
    : expectedNetMarginUsd.div(costUsd);

  return {
    pocaPriceKrw,
    totalCostKrw,
    costUsd,
    rawRecommendedPriceUsd,
    recommendedPriceUsd,
    expectedProceedsUsd,
    expectedNetMarginUsd,
    expectedNetMarginRate,
  };
}
