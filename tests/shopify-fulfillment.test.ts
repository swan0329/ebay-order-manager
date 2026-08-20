import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getShopifyConfig: () => ({ storeDomain: "test" }) }));
const request = vi.fn();
vi.mock("@/lib/services/shopifyService", () => ({ shopifyApiRequest: request }));

const { createShopifyFulfillment } = await import("@/lib/services/shopifyFulfillment");

describe("Shopify fulfillment", () => {
  beforeEach(() => request.mockReset());

  it("uses fulfillment orders and sends tracking without touching eBay", async () => {
    request
      .mockResolvedValueOnce({ fulfillment_orders: [{ id: 123, status: "open" }] })
      .mockResolvedValueOnce({ fulfillment: { id: 456 } });

    const result = await createShopifyFulfillment({
      orderId: "99",
      carrierCode: "Korea Post",
      trackingNumber: "TRACK-1",
    });

    expect(result).toEqual({ fulfillmentId: "456" });
    expect(request).toHaveBeenNthCalledWith(2, expect.anything(), {
      method: "POST",
      path: "/fulfillments.json",
      body: { fulfillment: expect.objectContaining({
        line_items_by_fulfillment_order: [{ fulfillment_order_id: 123 }],
        tracking_info: { company: "Korea Post", number: "TRACK-1" },
      }) },
    });
  });
});
