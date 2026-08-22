import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  listingUpsert: vi.fn(),
  listingUpdateMany: vi.fn(),
  getConfig: vi.fn(),
  setInventory: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: mocks.findMany },
    orderItem: { findMany: vi.fn().mockResolvedValue([]) },
    productListing: {
      upsert: mocks.listingUpsert,
      updateMany: mocks.listingUpdateMany,
    },
  },
}));
vi.mock("@/lib/env", () => ({ getShopifyConfig: mocks.getConfig }));
vi.mock("@/lib/services/shopifyService", () => ({
  setShopifyInventoryLevel: mocks.setInventory,
}));
vi.mock("@/lib/safe-log", () => ({ safeLog: vi.fn() }));

import { syncShopifyInventory } from "@/lib/services/channelInventorySync";

const listedProduct = {
  id: "product-1",
  sku: "CARD-1",
  stockQuantity: 2,
  safetyStock: 1,
  status: "active",
  isSoldOut: false,
  pocamarketAvailableCount: 1,
  pocamarketSyncedAt: new Date(),
  shopifyInventoryItemId: "inventory-1",
  shopifyProductId: "shopify-product-1",
  shopifyStatus: "active",
};

describe("Shopify 재고 반영 상태", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({ storeDomain: "example.myshopify.com" });
    mocks.setInventory.mockResolvedValue(undefined);
    mocks.listingUpsert.mockResolvedValue({});
    mocks.listingUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("Shopify가 재고를 수락한 뒤에만 채널 기록 수량을 갱신한다", async () => {
    mocks.findMany.mockResolvedValue([listedProduct]);

    await expect(syncShopifyInventory()).resolves.toMatchObject({ pushed: 1, failed: [] });
    expect(mocks.setInventory).toHaveBeenCalledWith(
      expect.anything(),
      "inventory-1",
      3,
    );
    expect(mocks.listingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quantity: 3 }),
      }),
    );
  });

  it("포카마켓 재고가 미확인이면 Shopify와 내부 기록 모두 바꾸지 않는다", async () => {
    mocks.findMany.mockResolvedValue([
      {
        ...listedProduct,
        stockQuantity: 0,
        pocamarketAvailableCount: null,
        pocamarketSyncedAt: null,
      },
    ]);

    await expect(syncShopifyInventory()).resolves.toMatchObject({ pushed: 0, unchanged: 1 });
    expect(mocks.setInventory).not.toHaveBeenCalled();
    expect(mocks.listingUpsert).not.toHaveBeenCalled();
  });
});
