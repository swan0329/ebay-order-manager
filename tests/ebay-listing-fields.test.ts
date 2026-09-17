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
  buildEbayVariationListingTitle,
  buildEbayListingDescription,
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
  it("deduplicates the brand and legacy album-derived version in BTS variation titles", () => {
    expect(buildEbayVariationListingTitle({
      groupName: "BTS", albumName: "BTS 3RD MUSTER ARMY.ZIP+ DVD",
      versionName: "3RD MUSTER ARMY.ZIP+ DVD", products: [baseProduct],
    })).toBe("BTS Official 3RD MUSTER ARMY.ZIP+ DVD Photocard Kpop");
  });

  it("keeps a distinct edition suffix when removing the repeated album", () => {
    expect(buildEbayVariationListingTitle({
      groupName: "BTS", albumName: "BTS 3RD MUSTER ARMY.ZIP+ DVD",
      versionName: "3rd muster army.zip+ dvd LIMITED", products: [baseProduct],
    })).toBe("BTS Official 3RD MUSTER ARMY.ZIP+ DVD LIMITED Photocard Kpop");
  });

  it("removes the repeated DICON album and its redundant brand suffix", () => {
    expect(buildEbayVariationListingTitle({
      groupName:"Stray Kids", albumName:"DICON D'FESTA MINI EDITION : Stray Kids",
      versionName:"DICON D'FESTA MINI EDITION :", products:[baseProduct],
    })).toBe("Stray Kids SKZ Official DICON D'FESTA MINI EDITION Photocard Kpop");
  });

  it("removes a redundant leading brand for singles without deleting an interior official name", () => {
    expect(buildEbayListingTitle({ ...baseProduct, brand: "BTS", optionName: "Jin", category: "BTS 3RD MUSTER ARMY.ZIP+ DVD" }))
      .toBe("BTS Jin Official 3RD MUSTER ARMY.ZIP+ DVD Photocard Kpop");
    expect(buildEbayListingTitle({ ...baseProduct, brand: "BTS", optionName: "Jin", category: "Us, Ourselves, and BTS WE" }))
      .toContain("Us, Ourselves, and BTS WE");
  });

  it("does not repeat the album for unit-card titles containing a leading brand", () => {
    const title=buildEbayListingTitle({ ...baseProduct, brand: "BTS", category: "BTS 3RD MUSTER ARMY.ZIP+ DVD",
      productName: "BTS BTS 3RD MUSTER ARMY.ZIP+ DVD Unit", optionName:"Unit", featuredMembers:"Jin, V" });
    expect(title.match(/3RD MUSTER/g)).toHaveLength(1);
    expect(title.match(/BTS/g)).toHaveLength(1);
  });

  it.each([
    JSON.stringify({ source: "import.csv", importedRow: { image: "https://ndc.infludeo.com/original.jpg" }, legacyEbayIds: ["123"] }),
    '{"source":"import.csv","importedRow":{"image":"https://ndc.infludeo.com/original.jpg',
  ])("never publishes internal import records as the listing description", (memo) => {
    const description = buildEbayListingDescription({ ...baseProduct, memo });
    expect(description).not.toMatch(/importedRow|legacyEbayIds|infludeo|import\.csv/);
    expect(description).toContain("Official ODDINARY Photocard");
  });

  it("preserves ordinary description copy stored in a legacy memo", () => {
    expect(buildEbayListingDescription({ ...baseProduct, memo: "Original official photocard." }))
      .toBe("Original official photocard.");
  });

  it("keeps every group member in descriptions even with a custom description", () => {
    const product = { ...baseProduct, brand: "BTS", optionName: "Unit", featuredMembers: "RM, Jin, SUGA, J-Hope, Jimin, V, Jungkook", descriptionHtml: "<p>Condition details</p>" };
    expect(buildEbayListingTitle(product)).toContain("Group OT7");
    expect(buildEbayListingDescription(product)).toContain("Condition details");
    expect(buildEbayListingDescription(product)).toContain(product.featuredMembers);
  });
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

  it.each([
    ["BTS", "2017 BTS LIVE TRILOGY EPISODE III THE WINGS TOUR in Japan MINI PHOTO CARD VER.2", "2017 LIVE TRILOGY EPISODE III THE WINGS TOUR in Japan MINI VER.2", "BTS 2017 THE WINGS TOUR in Japan MINI PHOTO CARD VER.2 Photocard"],
    ["Stray Kids", "Stray Kids 2nd World Tour MANIAC ENCORE in JAPAN SAITAMA SUPER ARENA", "2nd World Tour MANIAC ENCORE in JAPAN SAITAMA SUPER ARENA", "Stray Kids MANIAC ENCORE in JAPAN SAITAMA SUPER ARENA Photocard"],
  ])("preserves approved event identification for %s", (brand, albumName, versionName, expected) => {
    const product = { ...baseProduct, brand, category: albumName, optionName: "" };
    expect(buildEbayVariationListingTitle({ groupName: brand, albumName, versionName, products: [product] })).toBe(expected);
    expect(buildEbayListingTitle(product)).toBe(expected);
    expect(expected.length).toBeLessThanOrEqual(80);
    expect(product.category).toBe(albumName);
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

  it("uses the approved channel gallery before a raw user capture", () => {
    expect(
      buildEbayListingImageUrls({
        ...baseProduct,
        userFrontImageUrl: "https://r2.example/front.jpg",
        userBackImageUrl: "https://r2.example/back.jpg",
        ebayImageUrls: ["https://old.example/wrong.jpg"],
      }),
    ).toEqual(["https://old.example/wrong.jpg"]);
  });

  it("ignores data URLs and falls back to generated listing asset URLs", () => {
    expect(
      buildEbayListingImageUrls(
        {
          ...baseProduct,
          userFrontImageUrl: "data:image/jpeg;base64,abc",
          imageUrl: "/api/products/image-match/assets/card-1/front",
          ebayImageUrls: [],
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
