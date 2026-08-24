import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import {
  hasListingPrice,
  manualEbayPriceUsd,
  resolveListingPriceUsd,
} from "@/lib/listing-price";

const settings = {
  domesticShippingKrw: "3000",
  buyingAgencyFeeKrw: "1000",
  exchangeRateKrwPerUsd: "1400",
  targetMarginRate: "0.30",
  ebayFeeRate: "0.13",
  advertisingRate: "0.05",
  minimumSalePriceUsd: null,
  roundingIncrementUsd: "0.10",
};

function product(salePrice: string | null, ebayPrice: string | null) {
  return {
    salePrice: salePrice === null ? null : new Prisma.Decimal(salePrice),
    ebayPrice: ebayPrice === null ? null : new Prisma.Decimal(ebayPrice),
  };
}

describe("신규등록 판매가 결정", () => {
  it("포카마켓 가격과 수동 가격이 둘 다 있으면 사람이 확정한 옵션별 가격을 쓴다", () => {
    const result = resolveListingPriceUsd(product("10000", "9.99"), settings);
    expect(result?.source).toBe("manual");
    expect(result?.priceUsd.toFixed(2)).toBe("9.99");
  });

  it("포카마켓 가격이 없으면 수동 입력한 판매가를 쓴다", () => {
    const result = resolveListingPriceUsd(product(null, "9.99"), settings);
    expect(result?.source).toBe("manual");
    expect(result?.priceUsd.toFixed(2)).toBe("9.99");
  });

  it("포카마켓 가격이 0이면 없는 것으로 보고 수동 가격을 쓴다", () => {
    const result = resolveListingPriceUsd(product("0", "9.99"), settings);
    expect(result?.source).toBe("manual");
    expect(result?.priceUsd.toFixed(2)).toBe("9.99");
  });

  it("두 가격이 모두 없으면 가격을 정하지 못한다", () => {
    expect(resolveListingPriceUsd(product(null, null), settings)).toBeNull();
    expect(hasListingPrice(product(null, null))).toBe(false);
  });

  it("0 이하의 수동 가격은 입력되지 않은 것으로 본다", () => {
    expect(manualEbayPriceUsd(product(null, "0"))).toBeNull();
    expect(manualEbayPriceUsd(product(null, "-1"))).toBeNull();
    expect(hasListingPrice(product(null, "0"))).toBe(false);
  });

  it("가격이 한쪽이라도 있으면 등록 대상으로 본다", () => {
    expect(hasListingPrice(product("10000", null))).toBe(true);
    expect(hasListingPrice(product(null, "9.99"))).toBe(true);
  });
});
