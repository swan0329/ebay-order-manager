import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orderFind: vi.fn(),
  productFind: vi.fn(),
  mappingFind: vi.fn(),
  itemUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: mocks.orderFind },
    product: { findMany: mocks.productFind },
    productMapping: { findMany: mocks.mappingFind },
    orderItem: { update: mocks.itemUpdate },
  },
}));

import { matchOrderItemsForOrder } from "@/lib/product-matching";

const item = (id: string, sku: string | null, title = "카드") => ({
  id,
  sku,
  title,
  rawJson: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mappingFind.mockResolvedValue([]);
  mocks.itemUpdate.mockResolvedValue({});
});

describe("주문 항목 상품 매칭", () => {
  it("상품번호가 맞으면 전체 상품을 불러오지 않는다", async () => {
    mocks.orderFind.mockResolvedValue({
      id: "o1",
      userId: "u1",
      items: [item("i1", "505133"), item("i2", "505134")],
    });
    mocks.productFind.mockResolvedValueOnce([
      { id: "p1", sku: "505133", productName: "a", optionName: null, category: null, brand: null, memo: null },
      { id: "p2", sku: "505134", productName: "b", optionName: null, category: null, brand: null, memo: null },
    ]);
    const result = await matchOrderItemsForOrder("o1");
    expect(result).toEqual({ matched: 2, needsReview: 0 });
    // 상품번호로 좁힌 조회 한 번뿐이어야 한다.
    expect(mocks.productFind).toHaveBeenCalledTimes(1);
    expect(mocks.productFind.mock.calls[0][0].where).toMatchObject({
      sku: { in: ["505133", "505134"] },
    });
    expect(mocks.mappingFind).not.toHaveBeenCalled();
    expect(mocks.itemUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.itemUpdate.mock.calls[0][0].data).toMatchObject({
      productId: "p1",
      matchedBy: "sku",
    });
  });

  it("맞는 상품번호가 없는 항목이 있으면 그때만 전체 상품을 본다", async () => {
    mocks.orderFind.mockResolvedValue({
      id: "o1",
      userId: "u1",
      items: [item("i1", "505133"), item("i2", null, "이름만 있는 카드")],
    });
    mocks.productFind
      .mockResolvedValueOnce([
        { id: "p1", sku: "505133", productName: "a", optionName: null, category: null, brand: null, memo: null },
      ])
      .mockResolvedValueOnce([
        { id: "p1", sku: "505133", productName: "a", optionName: null, category: null, brand: null, memo: null },
        { id: "p9", sku: "999", productName: "이름만 있는 카드", optionName: null, category: null, brand: null, memo: null },
      ]);
    const result = await matchOrderItemsForOrder("o1");
    expect(mocks.productFind).toHaveBeenCalledTimes(2);
    expect(mocks.productFind.mock.calls[1][0].where).toEqual({
      status: { not: "inactive" },
    });
    expect(result.matched + result.needsReview).toBe(2);
  });

  it("매칭할 항목이 없으면 아무 상품도 불러오지 않는다", async () => {
    mocks.orderFind.mockResolvedValue({ id: "o1", userId: "u1", items: [] });
    expect(await matchOrderItemsForOrder("o1")).toEqual({
      matched: 0,
      needsReview: 0,
    });
    expect(mocks.productFind).not.toHaveBeenCalled();
  });
});
