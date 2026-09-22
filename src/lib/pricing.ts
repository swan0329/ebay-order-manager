import { Prisma } from "@/generated/prisma";

export type PricingInputs = {
  pocaPriceKrw: Prisma.Decimal.Value;
  domesticShippingKrw: Prisma.Decimal.Value;
  buyingAgencyFeeKrw: Prisma.Decimal.Value;
  exchangeRateKrwPerUsd: Prisma.Decimal.Value;
  targetMarginRate: Prisma.Decimal.Value;
  ebayFeeRate: Prisma.Decimal.Value;
  advertisingRate: Prisma.Decimal.Value;
  /** 최종가치수수료와 별도로 붙는 국제 판매 수수료 */
  internationalFeeRate?: Prisma.Decimal.Value;
  /** 주문 1건마다 붙는 고정비(USD) */
  perOrderFeeUsd?: Prisma.Decimal.Value;
  /** 구매자에게 받는 배송비(USD). eBay는 여기에도 수수료를 매긴다. */
  buyerShippingUsd?: Prisma.Decimal.Value;
  /** eBay가 걷는 판매세만큼 수수료 기준이 커지는 비율 */
  salesTaxUpliftRate?: Prisma.Decimal.Value;
  /** 판매 1건에 얹을 등록수수료(USD) */
  insertionFeeUsd?: Prisma.Decimal.Value;
  /** 실제로 배송에 드는 돈(USD). 구매자에게 받는 배송비와 다르면 차액이 손익이 된다. */
  shippingCostUsd?: Prisma.Decimal.Value;
  /** 카드 1장당 포장재 비용(원) */
  packagingCostKrw?: Prisma.Decimal.Value;
  /** 달러를 원화로 바꿀 때 떼이는 비율 */
  fxFeeRate?: Prisma.Decimal.Value;
  minimumSalePriceUsd?: Prisma.Decimal.Value | null;
  roundingIncrementUsd?: Prisma.Decimal.Value;
};

/**
 * 저장된 가격 설정을 계산 입력으로 옮긴다.
 *
 * 계산에 쓰는 설정은 반드시 이 함수 하나를 거친다. 호출부마다 필드를 손으로 나열하면
 * 새 수수료 항목이 추가될 때 조용히 빠져 실제 판매가만 낮아진다. 2026-09-18에
 * 국제수수료·주문당 고정비·구매자 배송비·판매세 가산·등록수수료를 계산식에 넣었지만
 * 등록·변동 경로가 옛 필드 목록을 그대로 쓰는 바람에 그 다섯 항목이 전부 0으로
 * 계산됐다. 같은 일이 반복되지 않도록 입력 구성을 한곳에 둔다.
 */
export type PricingSettingsRow = {
  domesticShippingKrw: Prisma.Decimal.Value;
  buyingAgencyFeeKrw: Prisma.Decimal.Value;
  exchangeRateKrwPerUsd: Prisma.Decimal.Value;
  targetMarginRate: Prisma.Decimal.Value;
  ebayFeeRate: Prisma.Decimal.Value;
  advertisingRate: Prisma.Decimal.Value;
  internationalFeeRate?: Prisma.Decimal.Value;
  perOrderFeeUsd?: Prisma.Decimal.Value;
  buyerShippingUsd?: Prisma.Decimal.Value;
  salesTaxUpliftRate?: Prisma.Decimal.Value;
  insertionFeeUsd?: Prisma.Decimal.Value;
  shippingCostUsd?: Prisma.Decimal.Value;
  packagingCostKrw?: Prisma.Decimal.Value;
  fxFeeRate?: Prisma.Decimal.Value;
  minimumSalePriceUsd?: Prisma.Decimal.Value | null;
  roundingIncrementUsd?: Prisma.Decimal.Value;
};

export function pricingInputsFromSettings(
  settings: PricingSettingsRow,
  pocaPriceKrw: Prisma.Decimal.Value,
): PricingInputs {
  return {
    pocaPriceKrw,
    domesticShippingKrw: settings.domesticShippingKrw,
    buyingAgencyFeeKrw: settings.buyingAgencyFeeKrw,
    exchangeRateKrwPerUsd: settings.exchangeRateKrwPerUsd,
    targetMarginRate: settings.targetMarginRate,
    ebayFeeRate: settings.ebayFeeRate,
    advertisingRate: settings.advertisingRate,
    internationalFeeRate: settings.internationalFeeRate ?? 0,
    perOrderFeeUsd: settings.perOrderFeeUsd ?? 0,
    buyerShippingUsd: settings.buyerShippingUsd ?? 0,
    salesTaxUpliftRate: settings.salesTaxUpliftRate ?? 0,
    insertionFeeUsd: settings.insertionFeeUsd ?? 0,
    shippingCostUsd: settings.shippingCostUsd ?? 0,
    packagingCostKrw: settings.packagingCostKrw ?? 0,
    fxFeeRate: settings.fxFeeRate ?? 0,
    minimumSalePriceUsd: settings.minimumSalePriceUsd,
    roundingIncrementUsd: settings.roundingIncrementUsd,
  };
}

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
  const feeTotal = new Prisma.Decimal(input.ebayFeeRate)
    .plus(input.advertisingRate)
    .plus(input.internationalFeeRate ?? 0);
  const uplift = new Prisma.Decimal(1).plus(input.salesTaxUpliftRate ?? 0);
  if (feeTotal.times(uplift).greaterThanOrEqualTo(1)) {
    throw new Error("수수료율의 합은 100% 미만이어야 합니다.");
  }
  for (const value of [
    input.internationalFeeRate ?? 0,
    input.perOrderFeeUsd ?? 0,
    input.buyerShippingUsd ?? 0,
    input.salesTaxUpliftRate ?? 0,
    input.insertionFeeUsd ?? 0,
    input.shippingCostUsd ?? 0,
    input.packagingCostKrw ?? 0,
    input.fxFeeRate ?? 0,
  ]) {
    if (new Prisma.Decimal(value).isNegative()) {
      throw new Error("비용과 비율은 0 이상이어야 합니다.");
    }
  }
  if (new Prisma.Decimal(input.fxFeeRate ?? 0).greaterThanOrEqualTo(1)) {
    throw new Error("환전 수수료는 100% 미만이어야 합니다.");
  }
  const increment = new Prisma.Decimal(input.roundingIncrementUsd ?? "0.10");
  if (increment.lessThanOrEqualTo(0)) {
    throw new Error("반올림 단위는 0보다 커야 합니다.");
  }
  if (
    input.minimumSalePriceUsd !== undefined &&
    input.minimumSalePriceUsd !== null &&
    new Prisma.Decimal(input.minimumSalePriceUsd).isNegative()
  ) {
    throw new Error("최소 판매가는 0 이상이어야 합니다.");
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
    .plus(input.buyingAgencyFeeKrw)
    .plus(input.packagingCostKrw ?? 0);
  const costUsd = totalCostKrw.div(input.exchangeRateKrwPerUsd);
  const feeRate = new Prisma.Decimal(input.ebayFeeRate)
    .plus(input.internationalFeeRate ?? 0)
    .plus(input.advertisingRate);
  // eBay는 상품값만이 아니라 배송비와 자기가 걷은 판매세에도 수수료를 매긴다.
  // 판매세만큼 수수료 기준이 커지는 몫을 uplift로 반영한다.
  const uplift = new Prisma.Decimal(1).plus(input.salesTaxUpliftRate ?? 0);
  const shipping = new Prisma.Decimal(input.buyerShippingUsd ?? 0);
  const perOrderFee = new Prisma.Decimal(input.perOrderFeeUsd ?? 0);
  const insertionFee = new Prisma.Decimal(input.insertionFeeUsd ?? 0);
  // 판매가에 붙는 수수료 몫. 이만큼은 판매가에서 먼저 빠져나간다.
  const priceFeeRate = feeRate.times(uplift);
  // 배송비·주문 고정비·등록수수료는 판매가와 상관없이 나가므로 원가 쪽에 더한다.
  // 구매자에게 받는 배송비로 실제 배송비를 메운다. 모자라면 그 차액이 비용이고,
  // 남으면 이익이다. 예전에는 이 차액이 어디에도 없어 조용히 손해가 났다.
  const shippingCost = new Prisma.Decimal(input.shippingCostUsd ?? 0);
  // 아직 실제 배송 원가를 넣지 않았으면 받는 배송비로 딱 맞는다고 본다. 0을 "공짜"로
  // 읽으면 받은 배송비가 전부 이익이 되어 판매가가 그만큼 내려간다.
  const shippingGapUsd = shippingCost.isZero()
    ? new Prisma.Decimal(0)
    : shippingCost.minus(shipping);
  const fixedCostUsd = shipping
    .times(uplift)
    .times(feeRate)
    .plus(perOrderFee)
    .plus(insertionFee)
    .plus(shippingGapUsd);
  // 달러를 원화로 바꿀 때 떼이는 만큼 실제로 받는 돈이 줄어든다. 목표 이익을 그대로
  // 남기려면 그 몫만큼 판매가가 더 커야 한다.
  const fxKeepRate = new Prisma.Decimal(1).minus(input.fxFeeRate ?? 0);
  const rawRecommendedPriceUsd = costUsd
    .times(new Prisma.Decimal(1).plus(input.targetMarginRate))
    .div(fxKeepRate)
    .plus(fixedCostUsd)
    .div(new Prisma.Decimal(1).minus(priceFeeRate));
  const increment = new Prisma.Decimal(input.roundingIncrementUsd ?? "0.10");
  let recommendedPriceUsd = rawRecommendedPriceUsd.div(increment).ceil().times(increment);
  if (input.minimumSalePriceUsd !== undefined && input.minimumSalePriceUsd !== null) {
    recommendedPriceUsd = Prisma.Decimal.max(
      recommendedPriceUsd,
      new Prisma.Decimal(input.minimumSalePriceUsd),
    );
  }
  // 실제로 eBay가 떼는 금액. 판매가와 배송비를 합친 금액에 판매세를 얹은 것이 기준이다.
  const feeBasisUsd = recommendedPriceUsd.plus(shipping).times(uplift);
  const ebayFeeUsd = feeBasisUsd
    .times(new Prisma.Decimal(input.ebayFeeRate).plus(input.internationalFeeRate ?? 0))
    .plus(perOrderFee);
  const advertisingFeeUsd = feeBasisUsd.times(input.advertisingRate);
  const totalFeeUsd = ebayFeeUsd.plus(advertisingFeeUsd).plus(insertionFee);
  // 배송비 차액을 반영하고, 남은 금액에서 환전 수수료를 뺀 것이 실제로 손에 쥐는 돈이다.
  const expectedProceedsUsd = recommendedPriceUsd
    .minus(totalFeeUsd)
    .minus(shippingGapUsd)
    .times(fxKeepRate);
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
    feeBasisUsd,
    ebayFeeUsd,
    advertisingFeeUsd,
    insertionFeeUsd: insertionFee,
    shippingGapUsd,
    totalFeeUsd,
    expectedProceedsUsd,
    expectedNetMarginUsd,
    expectedNetMarginRate,
  };
}
