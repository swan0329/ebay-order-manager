import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  update: vi.fn(),
  hold: vi.fn(),
  token: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { product: { update: mocks.update } },
}));
vi.mock("@/lib/env", () => ({
  getShopifyConfig: () => ({
    storeDomain: "shop.myshopify.com",
    apiVersion: "2026-01",
    accessToken: "token",
    clientId: null,
    clientSecret: null,
    locationId: "1",
  }),
}));
vi.mock("@/lib/shopify-price-hold", () => ({
  holdShopifyVariantForMissingPrice: mocks.hold,
  setShopifyPriceHoldFlag: vi.fn(),
}));

import { syncShopifyPriceAndInventory } from "@/lib/services/shopifyService";

const product = {
  id: "p1",
  sku: "82794",
  shopifyProductId: "15239144669552",
  shopifyVariantId: "54213268078960",
  shopifyInventoryItemId: "55402668720496",
  shopifyStatus: "PRICE_HOLD",
} as never;

function stubFetch(handler: (body: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body?: string }) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(handler(init?.body ?? "")),
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hold.mockRejectedValue(
    new Error("82794: Shopify 상품·옵션·재고 연결을 확인하지 못했습니다."),
  );
});

describe("Shopify 옵션이 사라진 상품", () => {
  it("삭제가 확인되면 연결을 끊고 신규등록으로 안내한다", async () => {
    // 옵션 조회는 오류 없이 비어 있고, 상위 상품 조회는 정상 응답한다.
    stubFetch((body) =>
      body.includes("linkProbe")
        ? { data: { productVariant: null } }
        : { data: { product: { id: "gid://shopify/Product/15239144669552", status: "ACTIVE" } } },
    );
    await expect(syncShopifyPriceAndInventory(product)).rejects.toThrow(
      "삭제되어 있어 연결을 해제했습니다",
    );
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "p1" },
      data: {
        shopifyProductId: null,
        shopifyVariantId: null,
        shopifyInventoryItemId: null,
        shopifyStatus: null,
      },
    });
  });

  it("조회에 오류가 있으면 연결을 끊지 않는다", async () => {
    stubFetch(() => ({ errors: [{ message: "Throttled" }] }));
    await expect(syncShopifyPriceAndInventory(product)).rejects.toThrow(
      "재시도가 필요합니다",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("옵션이 아직 있으면 연결을 끊지 않는다", async () => {
    stubFetch((body) =>
      body.includes("linkProbe")
        ? { data: { productVariant: { id: "gid://shopify/ProductVariant/54213268078960", sku: "82794" } } }
        : { data: { product: { id: "x", status: "ACTIVE" } } },
    );
    await expect(syncShopifyPriceAndInventory(product)).rejects.toThrow(
      "재시도가 필요합니다",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
