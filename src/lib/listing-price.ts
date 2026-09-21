import { Prisma } from "@/generated/prisma";
import { hasPocamarketPrice } from "@/lib/ebay-listing-fields";
import { calculateRecommendedPrice, pricingInputsFromSettings, type PricingSettingsRow } from "@/lib/pricing";
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

// 채널로 나가는 가격의 설정 입력. 계산식이 쓰는 항목과 같아야 하므로 목록을 따로
// 들고 있지 않는다.
export type ListingPriceSettings = PricingSettingsRow;

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
    // 설정의 모든 수수료 항목을 그대로 넘긴다. 여기서 항목을 골라 쓰면 판매가가
    // 설정 화면에서 본 값보다 낮아진다.
    const result = calculateRecommendedPrice(
      pricingInputsFromSettings(settings, product.salePrice!),
    );
    return { priceUsd: result.recommendedPriceUsd, source: "pocamarket" };
  }
  const priceUsd = approvedListingPriceUsd(product);
  return priceUsd ? { priceUsd, source: "manual_usd" } : null;
}

export function hasListingPrice(product: ListingPriceProduct) {
  return hasPocamarketPrice(product) || approvedListingPriceUsd(product) !== null;
}
