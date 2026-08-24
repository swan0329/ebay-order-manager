import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { resolveListingPriceUsd } from "@/lib/listing-price";

const settings = {
  domesticShippingKrw: 0,
  buyingAgencyFeeKrw: 0,
  exchangeRateKrwPerUsd: 1000,
  targetMarginRate: 0,
  ebayFeeRate: 0,
  advertisingRate: 0,
  minimumSalePriceUsd: 10,
  roundingIncrementUsd: 0.1,
};

describe("resolveListingPriceUsd", () => {
  it("preserves each explicit option price even when Pocamarket price also exists", () => {
    const first = resolveListingPriceUsd({ salePrice: new Prisma.Decimal(1000), ebayPrice: new Prisma.Decimal("12.30") }, settings);
    const second = resolveListingPriceUsd({ salePrice: new Prisma.Decimal(1000), ebayPrice: new Prisma.Decimal("27.40") }, settings);
    expect(first).toMatchObject({ source: "manual" });
    expect(first?.priceUsd.toFixed(2)).toBe("12.30");
    expect(second?.priceUsd.toFixed(2)).toBe("27.40");
  });

  it("uses the Pocamarket formula when no explicit option price exists", () => {
    const price = resolveListingPriceUsd({ salePrice: new Prisma.Decimal(1000), ebayPrice: null }, settings);
    expect(price).toMatchObject({ source: "pocamarket" });
    expect(price?.priceUsd.toFixed(2)).toBe("10.00");
  });
});
