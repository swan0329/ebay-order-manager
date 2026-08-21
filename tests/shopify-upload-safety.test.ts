import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/generated/prisma";

vi.mock("server-only", () => ({}));

import { uploadProductToShopify } from "@/lib/services/shopifyService";

// 이 두 오류는 Shopify API 호출 전에 막혀야 한다. 호출 뒤에 막으면 외부에
// 반쪽짜리 상품이 남거나, 원화 포카마켓 가격이 USD 가격으로 등록될 수 있다.
const baseProduct = {
  status: "active",
  stockQuantity: 1,
  safetyStock: 0,
  isSoldOut: false,
  pocamarketAvailableCount: 1,
  pocamarketSyncedAt: new Date(),
} as Product;

describe("Shopify 단품 등록 안전장치", () => {
  it("검증된 USD 판매가 없이는 외부 API를 부르지 않는다", async () => {
    await expect(uploadProductToShopify(baseProduct, undefined, 0, undefined)).rejects.toThrow(
      "검증된 USD 판매가",
    );
  });

  it("포카마켓 재고 출처가 미확인이면 상품 생성 전에 중단한다", async () => {
    await expect(
      uploadProductToShopify(
        {
          ...baseProduct,
          stockQuantity: 0,
          pocamarketAvailableCount: null,
          pocamarketSyncedAt: null,
        },
        undefined,
        0,
        "12.50",
      ),
    ).rejects.toThrow("포카마켓 재고가 확인되지 않아");
  });
});
