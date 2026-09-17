import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { approvedListingPriceUsd, hasListingPrice, resolveListingPriceUsd } from "@/lib/listing-price";

function product(finalListingPriceUsd: string | null, salePrice: string | null = null) {
  return {
    finalListingPriceUsd: finalListingPriceUsd === null ? null : new Prisma.Decimal(finalListingPriceUsd),
    salePrice: salePrice === null ? null : new Prisma.Decimal(salePrice),
  };
}

describe("채널 판매가 결정", () => {
  it("명시적으로 확정한 USD 가격만 채널 가격으로 반환한다", () => {
    const result = resolveListingPriceUsd(product("15.90"));
    expect(result?.source).toBe("manual_usd");
    expect(result?.priceUsd.toFixed(2)).toBe("15.90");
  });

  it("확정가가 없으면 채널 등록을 차단한다", () => {
    expect(resolveListingPriceUsd(product(null))).toBeNull();
    expect(hasListingPrice(product(null))).toBe(false);
  });

  it("포카마켓 원화 가격이 있으면 직접입력 USD보다 마진 계산가를 우선한다", () => {
    const settings = {
      domesticShippingKrw: "3000", buyingAgencyFeeKrw: "1000", exchangeRateKrwPerUsd: "1400",
      targetMarginRate: "0.30", ebayFeeRate: "0.13", advertisingRate: "0.05",
      minimumSalePriceUsd: null, roundingIncrementUsd: "0.10",
    };
    const result = resolveListingPriceUsd(product("9.99", "10000"), settings);
    expect(result?.source).toBe("pocamarket");
    expect(result?.priceUsd.toFixed(2)).toBe("15.90");
  });

  it("0 이하인 확정가는 유효한 채널 가격으로 보지 않는다", () => {
    expect(approvedListingPriceUsd(product("0"))).toBeNull();
    expect(approvedListingPriceUsd(product("-1"))).toBeNull();
  });
});
