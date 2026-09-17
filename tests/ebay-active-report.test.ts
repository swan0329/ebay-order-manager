import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { parseEbayActiveReport, resolveActiveListingMatches } from "@/lib/ebay-active-report";
import { parseEbayActiveInventoryArchive } from "@/lib/ebay-active-report-sync";

vi.mock("server-only", () => ({}));

describe("eBay active report parser", () => {
  it("does not restore a product link from a stored Item ID when the report has no exact SKU", () => {
    const result = resolveActiveListingMatches(
      [{ itemId: "157885338438", sku: null }],
      [{ id: "product-3646", sku: "3646", ebayItemId: "157885338438" }],
    );

    expect(result).toEqual([
      expect.objectContaining({ product: null, matchStatus: "UNMATCHED" }),
    ]);
  });

  it("matches only when the eBay SKU exactly equals the internal SKU", () => {
    const result = resolveActiveListingMatches(
      [{ itemId: "157885338438", sku: "3646" }],
      [{ id: "product-3646", sku: "3646", ebayItemId: "157885338438" }],
    );

    expect(result[0]).toEqual(expect.objectContaining({
      product: expect.objectContaining({ id: "product-3646" }),
      matchStatus: "MATCHED",
    }));
  });

  it("restores a blank-SKU report row only from a trusted site upload ledger", () => {
    const product = { id: "site-product", sku: "82825", ebayItemId: "157920092228" };
    const result = resolveActiveListingMatches(
      [{ itemId: "157920092228", sku: null }],
      [],
      new Map([["157920092228", product]]),
    );

    expect(result[0]).toEqual(expect.objectContaining({
      product: expect.objectContaining({ id: "site-product" }),
      matchStatus: "MATCHED",
    }));
  });

  it("does not let a site upload ledger override a different reported SKU", () => {
    const result = resolveActiveListingMatches(
      [{ itemId: "157920092228", sku: "DIFFERENT-SKU" }],
      [],
      new Map([["157920092228", {
        id: "site-product",
        sku: "82825",
        ebayItemId: "157920092228",
      }]]),
    );

    expect(result[0]).toEqual(expect.objectContaining({
      product: null,
      matchStatus: "UNMATCHED",
    }));
  });

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

  it("keeps separate variation SKUs that share one Item ID", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Item ID", "Custom label (SKU)", "Title", "Price", "Available quantity"],
      ["123456789012", "SKU-A", "Card set", "10", "1"],
      ["123456789012", "SKU-B", "Card set", "11", "2"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Listings");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    expect(parseEbayActiveReport(buffer).map((row) => row.sku)).toEqual(["SKU-A", "SKU-B"]);
  });

  it("parses each option from an automatic eBay active inventory archive", () => {
    const archive = new AdmZip();
    archive.addFile("active.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <BulkDataExchangeResponses>
        <ActiveInventoryReport>
          <SKUDetails>
            <ItemID>123456789012</ItemID><Title>Card set</Title>
            <Variations>
              <Variation><SKU>SKU-A</SKU><Price currencyID="USD">10.50</Price><Quantity>1</Quantity></Variation>
              <Variation><SKU>SKU-B</SKU><Price currencyID="USD">11.50</Price><Quantity>2</Quantity></Variation>
            </Variations>
          </SKUDetails>
        </ActiveInventoryReport>
      </BulkDataExchangeResponses>`));

    expect(parseEbayActiveInventoryArchive(archive.toBuffer())).toEqual([
      expect.objectContaining({ itemId: "123456789012", sku: "SKU-A", price: 10.5, quantity: 1, currency: "USD" }),
      expect.objectContaining({ itemId: "123456789012", sku: "SKU-B", price: 11.5, quantity: 2, currency: "USD" }),
    ]);
  });
});
