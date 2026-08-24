import { describe, expect, it } from "vitest";
import {
  buildVariationListingGroups,
  relationshipDetails,
  variationEbayTitle,
  variationSinglesToEnd,
} from "./variation-listing-groups";

const base = { brand: "Stray Kids", category: "HOP", productName: "JYP Shop", imageUrl: "https://example.com/card.jpg" };

describe("buildVariationListingGroups", () => {
  it("groups matching album/version cards and leaves singletons unmatched", () => {
    const result = buildVariationListingGroups([
      { ...base, id: "1", sku: "A-1", optionName: "Bang Chan" },
      { ...base, id: "2", sku: "A-2", optionName: "Felix" },
      { ...base, id: "3", sku: "A-3", optionName: "Hyunjin", productName: "Soundwave" },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].title).toBe("Stray Kids HOP JYP Shop");
    expect(result.groups[0].products.map((item) => item.variationName)).toEqual(["Bang Chan", "Felix"]);
    expect(result.unmatched.map((item) => item.sku)).toEqual(["A-3"]);
  });

  it("makes duplicate member option names unique", () => {
    const result = buildVariationListingGroups([
      { ...base, id: "1", sku: "A-1", optionName: "Felix" },
      { ...base, id: "2", sku: "A-2", optionName: "Felix" },
    ]);
    expect(result.groups[0].products.map((item) => item.variationName)).toEqual(["Felix", "Felix 2"]);
    expect(relationshipDetails(result.groups[0])).toBe("Card=Felix;Felix 2");
  });

  it("uses actual featured members instead of unit as the option name", () => {
    const result = buildVariationListingGroups([
      { ...base, id: "1", sku: "A-1", optionName: "unit", featuredMembers: "Changbin, Bang Chan" },
      { ...base, id: "2", sku: "A-2", optionName: "Han" },
    ]);
    expect(result.groups[0].products.map((item) => item.variationName)).toEqual(["Changbin, Bang Chan", "Han"]);
    expect(relationshipDetails(result.groups[0])).toBe("Card=Changbin, Bang Chan;Han");
  });

  it("keeps a unit card without assigned members out of listing groups", () => {
    const result = buildVariationListingGroups([
      { ...base, id: "1", sku: "A-1", optionName: "유닛", featuredMembers: null },
      { ...base, id: "2", sku: "A-2", optionName: "Han" },
    ]);
    expect(result.groups).toHaveLength(0);
    expect(result.unmatched.map((item) => item.sku)).toContain("A-1");
  });

  it("removes member/group/album from a verbose product name before grouping", () => {
    const result = buildVariationListingGroups([
      { ...base, id: "1", sku: "A-1", optionName: "Bang Chan", productName: "Stray Kids HOP Bang Chan JYP Shop" },
      { ...base, id: "2", sku: "A-2", optionName: "Felix", productName: "Stray Kids HOP Felix JYP Shop" },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].versionName).toBe("JYP Shop");
    expect(result.groups[0].title).toBe("Stray Kids HOP JYP Shop");
  });

  it("uses the album as one group when no version remains", () => {
    const result = buildVariationListingGroups([
      { ...base, id: "1", sku: "A-1", optionName: "Bang Chan", productName: "Stray Kids HOP Bang Chan Photocard" },
      { ...base, id: "2", sku: "A-2", optionName: "Felix", productName: "Stray Kids HOP Felix Photocard" },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].versionName).toBe("");
    expect(result.groups[0].title).toBe("Stray Kids HOP");
  });

  it("keeps the Photocard keyword within eBay's 80 character title limit", () => {
    const title = variationEbayTitle("Very Long Kpop Group Name With Many Characters Extremely Long Album Name With Extra Words");
    expect(title).toMatch(/ Photocard$/);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(variationEbayTitle("IVE Album Photocard")).toBe("IVE Album Photocard");
  });
});

describe("variationSinglesToEnd", () => {
  const single = (over: Partial<{ id: string; sku: string; ebayItemId: string | null; listingStatus: string | null }>) => ({
    id: "1",
    sku: "A-1",
    ebayItemId: "285000000001",
    listingStatus: "ACTIVE",
    ...over,
  });

  it("이미 등록된 묶음이면 활성 단품을 같은 파일에서 끝낸다", () => {
    const result = variationSinglesToEnd({
      products: [single({ id: "1" }), single({ id: "2", sku: "A-2", ebayItemId: "285000000002" })],
      parentItemId: "286123456789",
      endSingles: true,
      endNewGroupSingles: false,
    });
    expect(result.map((product) => product.id)).toEqual(["1", "2"]);
  });

  it("판매 종료됐거나 상품번호가 없는 카드는 넣지 않는다", () => {
    const result = variationSinglesToEnd({
      products: [
        single({ id: "1", listingStatus: "ENDED" }),
        single({ id: "2", sku: "A-2", ebayItemId: null }),
        single({ id: "3", sku: "A-3", ebayItemId: "285000000003", listingStatus: "PUBLISHED" }),
      ],
      parentItemId: "286123456789",
      endSingles: true,
      endNewGroupSingles: false,
    });
    expect(result.map((product) => product.id)).toEqual(["3"]);
  });

  it("부모 옵션상품 자신은 절대 끝내지 않는다", () => {
    const result = variationSinglesToEnd({
      products: [single({ id: "1", ebayItemId: "286123456789" })],
      parentItemId: "286123456789",
      endSingles: true,
      endNewGroupSingles: false,
    });
    expect(result).toEqual([]);
  });

  it("아직 eBay에 없는 신규 묶음은 기본으로 단품을 끝내지 않는다", () => {
    // 등록이 거부되면 단품만 사라져 파는 물건이 없어진다.
    const products = [single({ id: "1" })];
    expect(
      variationSinglesToEnd({ products, parentItemId: null, endSingles: true, endNewGroupSingles: false }),
    ).toEqual([]);
    expect(
      variationSinglesToEnd({ products, parentItemId: null, endSingles: true, endNewGroupSingles: true }),
    ).toHaveLength(1);
  });

  it("종료를 끄면 아무것도 넣지 않는다", () => {
    expect(
      variationSinglesToEnd({
        products: [single({ id: "1" })],
        parentItemId: "286123456789",
        endSingles: false,
        endNewGroupSingles: true,
      }),
    ).toEqual([]);
  });
});
