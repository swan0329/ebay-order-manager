import { describe, expect, it } from "vitest";
import {
  buildEbayListingCategoryId,
  buildEbayListingCategoryName,
  buildEbayListingConditionId,
  buildEbayListingImageUrls,
  buildEbayListingItemSpecifics,
  buildEbayListingPrice,
  hasPocamarketPrice,
  buildEbayListingTitle,
  type EbayListingFieldProduct,
} from "@/lib/ebay-listing-fields";

const baseProduct: EbayListingFieldProduct = {
  sku: "SKU-1",
  productName: "Stray Kids ODDINARY HYUNJIN",
  ebayTitle: "Old title",
  descriptionHtml: null,
  memo: null,
  ebayPrice: null,
  salePrice: { toString: () => "12.5", valueOf: () => 12.5 } as never,
  stockQuantity: 1,
  ebayImageUrls: [],
  ebayCondition: null,
  imageUrl: "https://source.example/pocamarket.jpg",
  sourceImageUrl: "https://source.example/original.jpg",
  ebayCategoryId: null,
  brand: "Stray Kids",
  category: "ODDINARY",
  optionName: "HYUNJIN",
};

describe("eBay listing fields", () => {
  it("never treats the PocaMarket KRW price as an eBay USD price", () => {
    expect(buildEbayListingPrice(baseProduct)).toBe("");
    expect(buildEbayListingPrice({
      ...baseProduct,
      ebayPrice: { toString: () => "12.34", valueOf: () => 12.34 } as never,
    })).toBe("12.34");
  });

  it("treats a missing or zero PocaMarket price as unavailable inventory", () => {
    expect(hasPocamarketPrice({ salePrice: null })).toBe(false);
    expect(hasPocamarketPrice({ salePrice: { valueOf: () => 0 } as never })).toBe(false);
    expect(hasPocamarketPrice({ salePrice: { valueOf: () => 12000 } as never })).toBe(true);
  });

  it("builds photocard titles in the requested eBay format", () => {
    expect(buildEbayListingTitle(baseProduct)).toBe(
      "Stray Kids SKZ Hyunjin Official ODDINARY Photocard Kpop",
    );
  });

  it("keeps Photocard keyword and shrinks long album names within 80 chars", () => {
    const longAlbumProduct: EbayListingFieldProduct = {
      ...baseProduct,
      optionName: "I.N",
      category: "SKZOO POP-UP & CAFE SKZOO'S MAGIC SCHOOL POP-UP STORE BOX TAPE SET",
    };
    const title = buildEbayListingTitle(longAlbumProduct);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title).toContain("Photocard");
    expect(title.startsWith("Stray Kids SKZ I.N Official")).toBe(true);
    // 단어 중간에서 잘리지 않아야 한다.
    expect(title).not.toMatch(/\bPOP$/);
  });

  it("lists featured members instead of 'unit' for unit cards", () => {
    const unitProduct: EbayListingFieldProduct = {
      ...baseProduct,
      optionName: "unit",
      featuredMembers: "Lee Know, I.N",
    };
    expect(buildEbayListingTitle(unitProduct)).toContain("Lee Know I.N");
    expect(buildEbayListingTitle(unitProduct).toLowerCase()).not.toContain("unit");
    expect(buildEbayListingItemSpecifics(unitProduct)["Featured Person/Artist"]).toBe(
      "Lee Know I.N",
    );
  });

  it("uses user uploaded listing images before stale marketplace images", () => {
    expect(
      buildEbayListingImageUrls({
        ...baseProduct,
        userFrontImageUrl: "https://r2.example/front.jpg",
        userBackImageUrl: "https://r2.example/back.jpg",
        ebayImageUrls: ["https://old.example/wrong.jpg"],
      }),
    ).toEqual(["https://r2.example/front.jpg", "https://r2.example/back.jpg"]);
  });

  it("ignores data URLs and falls back to generated listing asset URLs", () => {
    expect(
      buildEbayListingImageUrls(
        {
          ...baseProduct,
          userFrontImageUrl: "data:image/jpeg;base64,abc",
          imageUrl: "/api/products/image-match/assets/card-1/front",
          ebayImageUrls: ["https://old.example/wrong.jpg"],
        },
        "https://example.com",
      ),
    ).toEqual(["https://example.com/api/products/image-match/assets/card-1/front"]);
  });

  it("fills photocard item specifics from inventory fields", () => {
    expect(buildEbayListingItemSpecifics(baseProduct)).toMatchObject({
      Brand: "Stray Kids",
      Type: "Photocard",
      "Featured Person/Artist": "Hyunjin",
      Set: "ODDINARY",
      Genre: "K-Pop",
      "Original/Reproduction": "Original",
    });
  });

  it("clamps item specific values to eBay's 65-char limit on a word boundary", () => {
    const longSetProduct: EbayListingFieldProduct = {
      ...baseProduct,
      category: "SKZOO POP-UP & CAFE SKZOO'S MAGIC SCHOOL POP-UP STORE BOX TAPE SET",
    };
    const setValue = buildEbayListingItemSpecifics(longSetProduct).Set;
    expect(setValue.length).toBeLessThanOrEqual(65);
    expect(setValue).toBe(
      "SKZOO POP-UP & CAFE SKZOO'S MAGIC SCHOOL POP-UP STORE BOX TAPE",
    );
  });

  it("fills eBay category and condition defaults for upload rows", () => {
    expect(buildEbayListingCategoryId(baseProduct)).toBe("108857");
    expect(buildEbayListingCategoryName(baseProduct)).toBe("Other Music Memorabilia");
    expect(buildEbayListingConditionId(baseProduct)).toBe("1000");
  });
});
