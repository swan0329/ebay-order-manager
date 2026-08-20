import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ebay", () => ({
  EbayApiError: class EbayApiError extends Error {},
  getValidAccessToken: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEbayConfig: vi.fn() }));
vi.mock("@/lib/inventory", () => ({ restoreStockForReturnedOrderItem: vi.fn() }));
vi.mock("@/lib/orders", () => ({ writeSyncLog: vi.fn() }));
vi.mock("@/lib/safe-log", () => ({ safeLog: vi.fn() }));
vi.mock("@/lib/services/automaticChannelInventorySync", () => ({
  syncInventoryChannelsAfterChange: vi.fn(),
}));

const { parseReceivedEbayReturn } = await import("@/lib/services/ebayReturnSync");

describe("eBay received return parsing", () => {
  it("accepts an item only after eBay says it was delivered to the seller", () => {
    expect(parseReceivedEbayReturn({
      returnId: "return-1",
      orderId: "order-1",
      status: "ITEM_DELIVERED",
      creationInfo: {
        item: { itemId: "item-1", transactionId: "tx-1", returnQuantity: 1 },
      },
    })).toEqual({
      returnId: "return-1",
      orderId: "order-1",
      itemId: "item-1",
      transactionId: "tx-1",
      returnQuantity: 1,
    });
  });

  it("does not restore stock for opened or merely shipped returns", () => {
    for (const status of ["RETURN_REQUESTED", "ITEM_SHIPPED", "CLOSED"]) {
      expect(parseReceivedEbayReturn({
        returnId: "return-1",
        orderId: "order-1",
        status,
        creationInfo: {
          item: { itemId: "item-1", transactionId: "tx-1", returnQuantity: 1 },
        },
      })).toBeNull();
    }
  });
});
