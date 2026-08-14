import { describe, expect, it } from "vitest";
import {
  buildVariationListingGroups,
  relationshipDetails,
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
});

describe("variationSinglesToEnd", () => {
  const products = [
    { id: "1", sku: "A-1", ebayItemId: "285000000001", listingStatus: "ACTIVE" },
    { id: "2", sku: "A-2", ebayItemId: "285000000002", listingStatus: "ENDED" },
    { id: "3", sku: "A-3", ebayItemId: null, listingStatus: null },
  ];

  it("ends only the cards still live as singles", () => {
    const result = variationSinglesToEnd({
      products,
      parentItemId: "286000000000",
      endSingles: true,
      endNewGroupSingles: false,
    });
    expect(result.map((product) => product.sku)).toEqual(["A-1"]);
  });

  it("never ends the variation listing itself", () => {
    const result = variationSinglesToEnd({
      products: [{ id: "4", sku: "VAR-1", ebayItemId: "286000000000", listingStatus: "ACTIVE" }],
      parentItemId: "286000000000",
      endSingles: true,
      endNewGroupSingles: false,
    });
    expect(result).toEqual([]);
  });

  it("leaves singles alone for a group eBay does not have yet", () => {
    // Add가 거부되면 단품만 사라지므로, 사람이 위험을 알고 켰을 때만 넣는다.
    expect(
      variationSinglesToEnd({
        products,
        parentItemId: null,
        endSingles: true,
        endNewGroupSingles: false,
      }),
    ).toEqual([]);
    expect(
      variationSinglesToEnd({
        products,
        parentItemId: null,
        endSingles: true,
        endNewGroupSingles: true,
      }).map((product) => product.sku),
    ).toEqual(["A-1"]);
  });

  it("adds no End rows when the operator turned them off", () => {
    expect(
      variationSinglesToEnd({
        products,
        parentItemId: "286000000000",
        endSingles: false,
        endNewGroupSingles: true,
      }),
    ).toEqual([]);
  });
});
