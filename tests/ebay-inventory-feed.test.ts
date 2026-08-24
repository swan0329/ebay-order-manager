import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/ebayActiveReportSync", () => ({ decodeDownloadedEbayFile: (input: Buffer) => ({ content: input, format: "XML" }) }));

const { buildEbayInventoryFeed, parseEbayInventoryFeedResult } = await import("@/lib/services/ebayInventoryFeed");

describe("eBay inventory LMS feed", () => {
  it("builds one correlated request per single or variation target", () => {
    const xml = buildEbayInventoryFeed([
      { correlationId: "p1", itemId: "100", sku: null, quantity: 3, price: 7.5 },
      { correlationId: "p2", itemId: "200", sku: "CARD-B", quantity: 8, price: 12.3 },
    ]);
    expect(xml.match(/<ReviseInventoryStatusRequest/g)).toHaveLength(2);
    expect(xml).toContain("<MessageID>p1</MessageID>");
    expect(xml).toContain("<ItemID>100</ItemID><Quantity>3</Quantity><StartPrice>7.50</StartPrice>");
    expect(xml).toContain("<ItemID>200</ItemID><SKU>CARD-B</SKU><Quantity>8</Quantity><StartPrice>12.30</StartPrice>");
  });

  it("maps each eBay result back to the product correlation id", () => {
    const xml = Buffer.from(`<?xml version="1.0"?><BulkDataExchangeResponses>
      <ReviseInventoryStatusResponse><CorrelationID>p1</CorrelationID><Ack>Success</Ack></ReviseInventoryStatusResponse>
      <ReviseInventoryStatusResponse><CorrelationID>p2</CorrelationID><Ack>Failure</Ack><Errors><LongMessage>Invalid quantity</LongMessage></Errors></ReviseInventoryStatusResponse>
    </BulkDataExchangeResponses>`);
    expect(parseEbayInventoryFeedResult(xml)).toEqual([
      { correlationId: "p1", success: true, message: "SUCCESS" },
      { correlationId: "p2", success: false, message: "Invalid quantity" },
    ]);
  });
});
