import { describe, expect, it } from "vitest";
import { parseEbayOrder, parseShopifyOrder } from "@/lib/orders";

describe("parseShopifyOrder", () => {
  it("preserves tracking numbers from the actual Fulfillment array", () => {
    const parsed = parseShopifyOrder({ id: "gid://shopify/Order/1", fulfillments: [{ id: "f1", trackingInfo: [{ company: "DHL", number: "TRACK-1" }] }] });
    expect(parsed.shipments).toEqual([{ fulfillmentId: "f1", status: undefined, shippedAt: undefined, trackingNumber: "TRACK-1", carrierCode: "DHL" }]);
  });
  it("maps a paid Shopify order and its line items into the shared order model", () => {
    const parsed = parseShopifyOrder({
      id: "gid://shopify/Order/1234",
      legacyResourceId: "1234",
      name: "#1042",
      createdAt: "2026-08-30T01:00:00Z",
      processedAt: "2026-08-30T01:01:00Z",
      updatedAt: "2026-08-30T01:02:00Z",
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      totalPriceSet: {
        shopMoney: { amount: "19.95", currencyCode: "USD" },
      },
      shippingAddress: { name: "Buyer", countryCodeV2: "US" },
      lineItems: {
        nodes: [
          {
            id: "gid://shopify/LineItem/99",
            name: "Official Photocard",
            sku: "PC-001",
            quantity: 2,
            image: { url: "https://example.com/card.jpg" },
          },
        ],
      },
    });

    expect(parsed.externalOrderId).toBe("1234");
    expect(parsed.orderNumber).toBe("#1042");
    expect(parsed.orderStatus).toBe("OPEN");
    expect(parsed.fulfillmentStatus).toBe("NOT_STARTED");
    expect(parsed.totalAmount).toBe(19.95);
    expect(parsed.currency).toBe("USD");
    expect(parsed.buyerName).toBe("Buyer");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      lineItemId: "gid://shopify/LineItem/99",
      sku: "PC-001",
      quantity: 2,
    });
  });

  it("marks cancelled orders so previously deducted stock can be restored", () => {
    const parsed = parseShopifyOrder({
      id: "gid://shopify/Order/5678",
      name: "#1043",
      createdAt: "2026-08-30T01:00:00Z",
      displayFinancialStatus: "REFUNDED",
      displayFulfillmentStatus: "UNFULFILLED",
    });

    expect(parsed.orderStatus).toBe("CANCELLED");
  });
});

describe("parseEbayOrder cancellation", () => {
  it("normalizes a fully refunded eBay order for stock restoration", () => {
    const parsed = parseEbayOrder({
      orderId: "EBAY-1",
      orderStatus: "ACTIVE",
      orderPaymentStatus: "FULLY_REFUNDED",
      orderFulfillmentStatus: "NOT_STARTED",
      creationDate: "2026-08-30T01:00:00Z",
      lineItems: [],
    });

    expect(parsed.orderStatus).toBe("CANCELLED");
  });
});
