import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requiredEnv: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ requiredEnv: mocks.requiredEnv }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/shopifyService", () => ({
  findShopifyProductVariantsBySkus: vi.fn(),
}));
vi.mock("@/lib/services/shopifyVariationUpload", () => ({
  uploadShopifyVariationGroup: vi.fn(),
}));

import {
  issueShopifyRelinkPreviewToken,
  verifyShopifyRelinkPreviewToken,
} from "@/lib/services/shopifyRelinkPreview";
import { buildShopifyVariationRelinkPlan } from "@/lib/services/shopifyVariationRelink";

describe("Shopify 중복 묶음 연결 복구", () => {
  beforeEach(() => {
    mocks.requiredEnv.mockReturnValue("test-session-secret");
  });

  it("대상 상품에 모든 SKU가 정확히 한 번 있을 때만 연결 계획을 만든다", () => {
    const plan = buildShopifyVariationRelinkPlan(
      [
        { id: "p1", sku: "A", productName: "Card A" },
        { id: "p2", sku: "B", productName: "Card B" },
      ],
      [
        {
          sku: "A",
          productId: "new",
          productStatus: "ACTIVE",
          variantId: "11",
          inventoryItemId: "101",
          price: "10.00",
          inventoryQuantity: 0,
        },
        {
          sku: "B",
          productId: "new",
          productStatus: "ACTIVE",
          variantId: "12",
          inventoryItemId: "102",
          price: "11.00",
          inventoryQuantity: 0,
        },
        {
          sku: "A",
          productId: "old",
          productStatus: "ACTIVE",
          variantId: "21",
          inventoryItemId: "201",
          price: "10.00",
          inventoryQuantity: 1,
        },
      ],
      "old",
      "new",
    );
    expect(plan.productCount).toBe(2);
    expect(plan.products).toEqual([
      expect.objectContaining({ sku: "A", variantId: "11", inventoryItemId: "101" }),
      expect.objectContaining({ sku: "B", variantId: "12", inventoryItemId: "102" }),
    ]);
    expect(plan.candidates).toEqual([
      { productId: "new", matchedSkuCount: 2 },
      { productId: "old", matchedSkuCount: 1 },
    ]);
  });

  it("대상 상품에 빠진 SKU가 있으면 실행 계획을 거부한다", () => {
    expect(() =>
      buildShopifyVariationRelinkPlan(
        [
          { id: "p1", sku: "A", productName: "Card A" },
          { id: "p2", sku: "B", productName: "Card B" },
        ],
        [
          {
            sku: "A",
            productId: "new",
            productStatus: "ACTIVE",
            variantId: "11",
            inventoryItemId: "101",
            price: "10.00",
            inventoryQuantity: 0,
          },
        ],
        "old",
        "new",
      ),
    ).toThrow("대상 상품에 없는 SKU: B");
  });

  it("15분 미리보기 토큰은 대상 상품이 바뀌면 거부한다", () => {
    const issuedAt = 1_000_000;
    const token = issueShopifyRelinkPreviewToken("seed", "new", issuedAt);
    expect(
      verifyShopifyRelinkPreviewToken(token, "seed", "new", issuedAt + 60_000),
    ).toBe(true);
    expect(
      verifyShopifyRelinkPreviewToken(token, "seed", "other", issuedAt + 60_000),
    ).toBe(false);
    expect(
      verifyShopifyRelinkPreviewToken(token, "seed", "new", issuedAt + 16 * 60_000),
    ).toBe(false);
  });
});
