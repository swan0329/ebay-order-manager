import { describe, expect, it } from "vitest";
import { buildEbayEndListingsCsv } from "./ebay-end-listing-csv";

describe("buildEbayEndListingsCsv", () => {
  it("includes eBay's required ending reason for every End row", () => {
    const csv = buildEbayEndListingsCsv([
      { ebayItemId: "123456789012", sku: "CARD-1" },
      { ebayItemId: "123456789013", sku: "CARD-2" },
    ]);

    expect(csv.split("\r\n")).toEqual([
      '"*Action(SiteID=US|Country=US|Currency=USD|Version=1193)","Item number","Custom label (SKU)","EndingReason"',
      '"End","123456789012","CARD-1","NotAvailable"',
      '"End","123456789013","CARD-2","NotAvailable"',
    ]);
  });
});
