import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDownloadedActiveReport } from "@/lib/services/ebayActiveReportSync";

function zipSingleFile(name: string, content: Buffer) {
  const nameBytes = Buffer.from(name);
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(local.length + nameBytes.length + compressed.length, 16);
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, eocd]);
}

describe("eBay Feed active report download parser", () => {
  it("reads the ZIP/XML file returned by LMS_ACTIVE_INVENTORY_REPORT", () => {
    const xml = Buffer.from(`<?xml version="1.0"?><BulkDataExchangeResponses><ActiveInventoryReport><SKUDetails><SKU>PARENT-SKU</SKU><Price currencyID="USD">12.50</Price><Quantity>3</Quantity><ItemID>123456789012</ItemID></SKUDetails></ActiveInventoryReport></BulkDataExchangeResponses>`);
    expect(parseDownloadedActiveReport(zipSingleFile("active-inventory.xml", xml))).toEqual([
      expect.objectContaining({ itemId: "123456789012", sku: "PARENT-SKU", price: 12.5, quantity: 3, currency: "USD" }),
    ]);
  });

  it("keeps the parent snapshot when an XML report has variations", () => {
    const xml = Buffer.from(`<ActiveInventoryReport><SKUDetails><SKU>PARENT</SKU><Price currencyID="USD">20</Price><Quantity>5</Quantity><ItemID>123456789012</ItemID><Variations><Variation><SKU>OPTION-A</SKU><Price currencyID="USD">10</Price><Quantity>1</Quantity></Variation></Variations></SKUDetails></ActiveInventoryReport>`);
    expect(parseDownloadedActiveReport(xml)).toEqual([
      expect.objectContaining({ itemId: "123456789012", sku: "PARENT", price: 20, quantity: 5 }),
    ]);
  });
});
