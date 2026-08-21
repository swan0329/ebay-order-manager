import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getToken: vi.fn(),
  safeLog: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getShopifyConfig: mocks.getConfig }));
vi.mock("@/lib/services/shopifyToken", () => ({ getShopifyAccessToken: mocks.getToken }));
vi.mock("@/lib/safe-log", () => ({ safeLog: mocks.safeLog }));

import { upsertShopifyVariationProduct } from "@/lib/services/shopifyService";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Shopify 묶음상품 부분 실패", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getConfig.mockReturnValue({
      storeDomain: "example.myshopify.com",
      apiVersion: "2025-10",
      locationId: "1",
    });
    mocks.getToken.mockResolvedValue("token");
  });

  it("한 옵션의 재고 반영이 실패해도 생성된 Shopify 상품과 다른 옵션 결과를 돌려준다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        product: {
          id: 100,
          status: "active",
          variants: [
            { id: 11, sku: "CARD-A", inventory_item_id: 101 },
            { id: 12, sku: "CARD-B", inventory_item_id: 102 },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ error: "inventory unavailable" }, 500))
      .mockResolvedValueOnce(jsonResponse({ data: { productUpdate: { userErrors: [] } } }));

    const result = await upsertShopifyVariationProduct("Test group", [
      { sku: "CARD-A", optionName: "A", priceUsd: "10.00", quantity: 1, imageUrls: [] },
      { sku: "CARD-B", optionName: "B", priceUsd: "11.00", quantity: 0, imageUrls: [] },
    ]);

    expect(result.productId).toBe("100");
    expect(result.variants).toEqual([
      expect.objectContaining({ sku: "CARD-A", inventorySynced: true, inventoryError: null }),
      expect.objectContaining({ sku: "CARD-B", inventorySynced: false, inventoryError: "Shopify Admin API request failed." }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
