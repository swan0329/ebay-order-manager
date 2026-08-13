import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { parseEbayActiveReport } from "@/lib/ebay-active-report";

vi.mock("server-only", () => ({}));

describe("eBay active report parser", () => {
  it("finds Seller Hub headers after metadata rows", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["#INFO", "Version=1.0"],
      [],
      ["Item ID", "Custom label (SKU)", "Title", "Price", "Available quantity"],
      ["123456789012", "SKU-1", "Card one", "12.50 USD", "3"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Listings");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    expect(parseEbayActiveReport(buffer)).toEqual([
      expect.objectContaining({
        itemId: "123456789012",
        sku: "SKU-1",
        title: "Card one",
        price: 12.5,
        quantity: 3,
      }),
    ]);
  });

  it("rejects a file without an Item ID column", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["SKU", "Title"], ["SKU-1", "Card"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Wrong");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    expect(() => parseEbayActiveReport(buffer)).toThrow("Item ID");
  });
});
