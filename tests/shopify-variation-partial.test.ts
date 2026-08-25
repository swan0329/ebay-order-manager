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

import { onlyAlreadyAttachedVariantMediaErrors, upsertShopifyVariationProduct } from "@/lib/services/shopifyService";

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

  it("이미 연결된 옵션 사진 응답은 재조회 대상으로만 허용한다", () => {
    expect(onlyAlreadyAttachedVariantMediaErrors([
      { message: "The given variant already has attached media." },
      { message: "The given variant already has attached media." },
    ])).toBe(true);
    expect(onlyAlreadyAttachedVariantMediaErrors([
      { message: "The given variant already has attached media." },
      { message: "Media is invalid." },
    ])).toBe(false);
    expect(onlyAlreadyAttachedVariantMediaErrors([])).toBe(false);
  });

  it("한 옵션의 재고 반영이 실패해도 생성된 Shopify 상품과 다른 옵션 결과를 돌려준다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        product: {
          id: 100,
          status: "active",
          variants: [
            { id: 11, sku: "CARD-A", price: "10.00", inventory_item_id: 101 },
            { id: 12, sku: "CARD-B", price: "11.00", inventory_item_id: 102 },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ inventory_levels: [{ inventory_item_id: 101, location_id: 1, available: 1 }] }))
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("레거시 REST 상품 생성이 500이면 GraphQL 상품 생성으로 한 번만 대체한다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ errors: "Internal Server Error" }, 500))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          productSet: {
            product: {
              id: "gid://shopify/Product/200",
              status: "ACTIVE",
              variants: { nodes: [
                { id: "gid://shopify/ProductVariant/21", sku: "CARD-A", price: "10.00", inventoryItem: { id: "gid://shopify/InventoryItem/201" } },
                { id: "gid://shopify/ProductVariant/22", sku: "CARD-B", price: "11.00", inventoryItem: { id: "gid://shopify/InventoryItem/202" } },
              ] },
            },
            userErrors: [],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ inventory_levels: [{ inventory_item_id: 201, location_id: 1, available: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ inventory_levels: [{ inventory_item_id: 202, location_id: 1, available: 0 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { productUpdate: { userErrors: [] } } }));

    await expect(upsertShopifyVariationProduct("Fallback group", [
      { sku: "CARD-A", optionName: "A", priceUsd: "10.00", quantity: 1, imageUrls: [] },
      { sku: "CARD-B", optionName: "B", priceUsd: "11.00", quantity: 0, imageUrls: [] },
    ])).resolves.toMatchObject({ productId: "200", variants: [
      { sku: "CARD-A", inventorySynced: true },
      { sku: "CARD-B", inventorySynced: true },
    ] });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/graphql.json");
  });
});
