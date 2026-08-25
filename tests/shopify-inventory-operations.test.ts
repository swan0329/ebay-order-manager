import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  findProducts: vi.fn(), findSettings: vi.fn(), findOrders: vi.fn(), updateProduct: vi.fn(), upsertListing: vi.fn(), transaction: vi.fn(),
  setInventory: vi.fn(), updatePrices: vi.fn(), getInventory: vi.fn(), getPrices: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findMany: mocks.findProducts, update: mocks.updateProduct },
  pricingSettings: { findUnique: mocks.findSettings }, orderItem: { findMany: mocks.findOrders },
  productListing: { upsert: mocks.upsertListing }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/env", () => ({ getShopifyConfig: () => ({ storeDomain: "test.myshopify.com", apiVersion: "2026-04", locationId: "1" }) }));
vi.mock("@/lib/listing-price", () => ({ resolveListingPriceUsd: () => ({ priceUsd: { toString: () => "12.30" } }) }));
vi.mock("@/lib/services/shopifyService", () => ({
  setShopifyInventoryLevel: mocks.setInventory, updateShopifyVariantPrices: mocks.updatePrices,
  getShopifyInventoryLevel: mocks.getInventory, getShopifyVariantPrices: mocks.getPrices,
}));

const { reconcileShopifyPriceInventory, syncShopifyPriceInventory } = await import("@/lib/services/shopifyInventoryOperations");

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1", sku: "SKU-1", status: "active", stockQuantity: 2, isSoldOut: false,
    pocamarketAvailableCount: 3, pocamarketSyncedAt: new Date(), shopifyProductId: "100",
    shopifyVariantId: "11", shopifyInventoryItemId: "21", shopifyStatus: "ACTIVE",
    productListings: [{ id: "l1", externalId: "100", price: 10, quantity: 1, metadata: { imageSync: { status: "READY" } } }],
    ...overrides,
  };
}

describe("Shopify 가격·재고 전용 작업", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.findProducts.mockResolvedValue([product()]); mocks.findSettings.mockResolvedValue({ id: "default" });
    mocks.findOrders.mockResolvedValue([]); mocks.setInventory.mockResolvedValue(undefined);
    mocks.updatePrices.mockResolvedValue([{ variantId: "11", priceUsd: "12.30", actualPrice: "12.30", synced: true }]);
    mocks.transaction.mockResolvedValue([]);
  });

  it("가격·재고 변경에서 이미지 작업 없이 실제 가격과 수량만 갱신한다", async () => {
    const result = await syncShopifyPriceInventory(["p1"], "CHANGE");
    expect(mocks.updatePrices).toHaveBeenCalledWith(expect.anything(), "100", [{ variantId: "11", priceUsd: "12.30" }]);
    expect(mocks.setInventory).toHaveBeenCalledWith(expect.anything(), "21", 5);
    expect(mocks.upsertListing).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ price: "12.30", quantity: 5 }) }));
    expect(result).toMatchObject({ succeeded: 1, failed: [] });
  });

  it("품절은 판매가가 없어도 가격을 건드리지 않고 수량 0만 반영한다", async () => {
    mocks.findProducts.mockResolvedValue([product({ stockQuantity: 0, isSoldOut: true, pocamarketAvailableCount: 0 })]);
    mocks.findSettings.mockResolvedValue(null);
    const result = await syncShopifyPriceInventory(["p1"], "UNAVAILABLE");
    expect(mocks.updatePrices).not.toHaveBeenCalled();
    expect(mocks.setInventory).toHaveBeenCalledWith(expect.anything(), "21", 0);
    expect(mocks.upsertListing).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ quantity: 0 }) }));
    expect(result.failed).toEqual([]);
  });

  it("실제 가격·재고가 목표와 같으면 외부 쓰기 없이 내부 완료 기준을 복구한다", async () => {
    mocks.getInventory.mockResolvedValue(5);
    mocks.getPrices.mockResolvedValue(new Map([["11", "12.30"]]));

    const result = await reconcileShopifyPriceInventory(["p1"], "CHANGE");

    expect(mocks.setInventory).not.toHaveBeenCalled();
    expect(mocks.updatePrices).not.toHaveBeenCalled();
    expect(mocks.upsertListing).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ price: "12.30", quantity: 5 }),
    }));
    expect(result).toEqual([expect.objectContaining({ sku: "SKU-1", current: true })]);
  });

  it("실제값 조회 오류는 전체 요청을 중단하지 않고 해당 항목의 원인으로 돌려준다", async () => {
    mocks.getInventory.mockRejectedValue(new Error("Shopify 429"));

    const result = await reconcileShopifyPriceInventory(["p1"], "CHANGE");

    expect(result).toEqual([expect.objectContaining({ current: false, reason: "Shopify 실제값 조회 실패: Shopify 429" })]);
    expect(mocks.upsertListing).not.toHaveBeenCalled();
  });
});
