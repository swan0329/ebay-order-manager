import { Prisma } from "@/generated/prisma";
import { hasPocamarketPrice } from "@/lib/ebay-listing-fields";
import { calculateRecommendedPrice } from "@/lib/pricing";
import { procurementHoldReason, procurementCostNeedsVerification, type ProcurementFreshness } from "@/lib/procurement-freshness";
export type ListingPriceProduct = ProcurementFreshness & {
  stockQuantity?: number;
  // The only price allowed to leave this application for eBay or Shopify.
  // salePrice is KRW source data and ebayPrice is a legacy/manual candidate;
  // neither may be sent to a channel until explicitly approved.
  finalListingPriceUsd: Prisma.Decimal | null;
  finalListingPriceSource?: string | null;
  salePrice: Prisma.Decimal | null;
};

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

export type ListingPrice = {
  priceUsd: Prisma.Decimal;
  source: "pocamarket" | "manual_usd";
};

export function approvedListingPriceUsd(
  product: ListingPriceProduct,
): Prisma.Decimal | null {
  if (product.finalListingPriceUsd === null || product.finalListingPriceUsd === undefined) {
    return null;
  }
  const value = new Prisma.Decimal(product.finalListingPriceUsd);
  return value.isFinite() && value.greaterThan(0) ? value : null;
}

// 포카마켓 가격이 있으면 설정된 마진 공식으로 USD를 계산한다. 직접입력 USD는
// 포카마켓 가격이 없을 때만 최종 판매가로 사용한다.
export function resolveListingPriceUsd(
  product: ListingPriceProduct,
  settings?: ListingPriceSettings,
): ListingPrice | null {
  if (procurementCostNeedsVerification(product)) return null;
  if (product.stockQuantity === 0 && procurementHoldReason(product)) return null;
  if (hasPocamarketPrice(product)) {
    if (!settings) return null;
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
  const priceUsd = approvedListingPriceUsd(product);
  return priceUsd ? { priceUsd, source: "manual_usd" } : null;
}

export function hasListingPrice(product: ListingPriceProduct) {
  return hasPocamarketPrice(product) || approvedListingPriceUsd(product) !== null;
}
