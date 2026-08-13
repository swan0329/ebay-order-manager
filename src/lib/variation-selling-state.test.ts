import { describe, expect, it } from "vitest";
import { collectActiveVariationProductIds } from "./variation-selling-state-core";

describe("collectActiveVariationProductIds", () => {
  it("collects unique card ids only from active variation listings", () => {
    expect(collectActiveVariationProductIds([
      { ebayItemId: "100", includedProductIds: ["a", "b"] },
      { ebayItemId: "101", includedProductIds: ["b", "c", 4] },
      { ebayItemId: null, includedProductIds: ["ended"] },
    ])).toEqual(["a", "b", "c"]);
  });
});
