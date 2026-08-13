import { describe, expect, it } from "vitest";
import { buildVariationListingGroups, relationshipDetails } from "./variation-listing-groups";

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
