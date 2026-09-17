import { expect, it } from "vitest";
import { parseChangeSkus, selectChangedProducts } from "./change-product-selection";
it("preserves compound SKU identifiers and removes duplicates across pasted separators", () => {
  expect(parseChangeSkus("15369_15372, 00123\n15369_15372\t112595_2;101214")).toEqual(["15369_15372", "00123", "112595_2", "101214"]);
});
it("never broadens an empty or unmatched selection to all products", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  expect(selectChangedProducts(rows, [], p => p.id)).toEqual([]);
  expect(selectChangedProducts(rows, ["missing"], p => p.id)).toEqual([]);
  expect(selectChangedProducts(rows, ["b"], p => p.id)).toEqual([{ id: "b" }]);
  expect(selectChangedProducts(rows, undefined, p => p.id)).toEqual(rows);
});
