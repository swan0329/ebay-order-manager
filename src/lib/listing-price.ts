import { Prisma } from "@/generated/prisma";
import { hasPocamarketPrice } from "@/lib/ebay-listing-fields";
import { calculateRecommendedPrice } from "@/lib/pricing";

// eBay 업로드 자료에 넣을 판매가(USD)를 정하는 단일 경로.
// 신규등록 파일을 만드는 모든 요청은 이 모듈을 통해 가격을 얻는다.

export type ListingPriceSettings = {
  domesticShippingKrw: Prisma.Decimal.Value;
  buyingAgencyFeeKrw: Prisma.Decimal.Value;
  exchangeRateKrwPerUsd: Prisma.Decimal.Value;
  targetMarginRate: Prisma.Decimal.Value;
  ebayFeeRate: Prisma.Decimal.Value;
  advertisingRate: Prisma.Decimal.Value;
  minimumSalePriceUsd?: Prisma.Decimal.Value | null;
  roundingIncrementUsd?: Prisma.Decimal.Value;
};

export type ListingPriceProduct = {
  // 포카마켓 표시가(KRW). 포카마켓 동기화가 채우는 값이다.
  salePrice: Prisma.Decimal | null;
  // 사람이 직접 입력한 eBay 판매가(USD).
  ebayPrice: Prisma.Decimal | null;
};

export type ListingPriceSource = "pocamarket" | "manual";

export type ListingPrice = {
  priceUsd: Prisma.Decimal;
  source: ListingPriceSource;
};

// 수동 입력한 eBay 판매가(USD). 비어 있거나 0 이하면 "없음"으로 본다.
export function manualEbayPriceUsd(
  product: Pick<ListingPriceProduct, "ebayPrice">,
): Prisma.Decimal | null {
  if (product.ebayPrice === null || product.ebayPrice === undefined) {
    return null;
  }

  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(product.ebayPrice);
  } catch {
    return null;
  }

  return value.isFinite() && value.greaterThan(0) ? value : null;
}

// 사람이 상품별로 확정한 eBay 판매가가 있으면 그 값을 우선한다. 명시적 옵션별
// 가격을 포카마켓 공통 최저가 계산으로 덮으면 묶음의 모든 옵션이 같은 가격이 될
// 수 있다. 수동값이 없는 상품만 최신 포카마켓 원가와 마진 공식으로 계산한다.
export function resolveListingPriceUsd(
  product: ListingPriceProduct,
  settings: ListingPriceSettings,
): ListingPrice | null {
  const manual = manualEbayPriceUsd(product);
  if (manual) return { priceUsd: manual, source: "manual" };

  if (hasPocamarketPrice(product)) {
    const result = calculateRecommendedPrice({
      pocaPriceKrw: product.salePrice!,
      domesticShippingKrw: settings.domesticShippingKrw,
      buyingAgencyFeeKrw: settings.buyingAgencyFeeKrw,
      exchangeRateKrwPerUsd: settings.exchangeRateKrwPerUsd,
      targetMarginRate: settings.targetMarginRate,
      ebayFeeRate: settings.ebayFeeRate,
      advertisingRate: settings.advertisingRate,
      minimumSalePriceUsd: settings.minimumSalePriceUsd,
      roundingIncrementUsd: settings.roundingIncrementUsd,
    });

    return { priceUsd: result.recommendedPriceUsd, source: "pocamarket" };
  }

  return null;
}

// 가격 설정 없이도 판정할 수 있는 "가격이 있는가". 목록 필터와 안내 문구에 쓴다.
export function hasListingPrice(product: ListingPriceProduct) {
  return hasPocamarketPrice(product) || manualEbayPriceUsd(product) !== null;
}
