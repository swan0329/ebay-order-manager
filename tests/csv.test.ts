import { describe, expect, it } from "vitest";
import { parseCsvObjects, toCsv } from "../src/lib/csv";

describe("csv helpers", () => {
  it("round trips quoted commas, quotes, and newlines", () => {
    const csv = toCsv([
      ["sku", "product_name", "memo"],
      ["SKU-1", 'A "quoted" item', "line 1\nline 2, with comma"],
    ]);

    expect(parseCsvObjects(csv)).toEqual([
      {
        sku: "SKU-1",
        product_name: 'A "quoted" item',
        memo: "line 1\nline 2, with comma",
      },
    ]);
  });

  it("ignores a UTF-8 BOM and blank rows", () => {
    expect(parseCsvObjects("\uFEFFsku,product_name\nSKU-2,Card\n,\n")).toEqual([
      { sku: "SKU-2", product_name: "Card" },
    ]);
  });
});
