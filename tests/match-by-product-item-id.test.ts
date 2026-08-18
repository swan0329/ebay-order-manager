import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { resolveOrderItemProductMatch } = await import("@/lib/product-matching");

// 이름과 앨범, 멤버가 같고 포즈만 다른 카드들. 제목만으로는 절대 가릴 수 없다.
const poseA = {
  id: "a",
  sku: "82737",
  productName: "Stray Kids DICON D'FESTA MINI EDITION : Stray Kids HAN",
  optionName: "HAN",
  category: "DICON D'FESTA MINI EDITION",
  brand: "Stray Kids",
  ebayItemId: "157910133533",
};
const poseB = {
  ...poseA,
  id: "b",
  sku: "82759",
  ebayItemId: "157910130906",
};
const products = [poseA, poseB];

const orderItem = (raw: Record<string, unknown>, sku: string | null = null) => ({
  id: "item-1",
  title: "Stray Kids SKZ Han Official DICON D'FESTA MINI EDITION Photocard",
  sku,
  rawJson: raw,
});

describe("주문에 SKU가 없을 때 상품의 eBay 상품번호로 가린다", () => {
  it("상품에 저장된 상품번호와 같은 카드를 고른다", () => {
    // 예전에는 이 경우 제목 유사도로 떨어져 포즈가 다른 82759에 붙었다.
    const result = resolveOrderItemProductMatch(
      orderItem({ legacyItemId: "157910133533" }),
      products,
    );
    expect(result.product?.sku).toBe("82737");
    expect(result.matchedBy).toBe("item_id");
  });

  it("다른 상품번호면 그쪽 카드를 고른다", () => {
    const result = resolveOrderItemProductMatch(
      orderItem({ legacyItemId: "157910130906" }),
      products,
    );
    expect(result.product?.sku).toBe("82759");
  });

  it("주문 SKU가 있으면 그것이 우선이다", () => {
    const result = resolveOrderItemProductMatch(
      orderItem({ legacyItemId: "157910133533" }, "82759"),
      products,
    );
    expect(result.product?.sku).toBe("82759");
    expect(result.matchedBy).toBe("sku");
  });

  it("여러 카드가 한 상품번호를 함께 쓰면 고르지 않는다", () => {
    // 옵션상품은 카드 여러 장이 상품번호 하나를 공유한다. 이때 임의로 하나를
    // 고르면 오늘 있었던 잘못된 연결이 그대로 반복된다.
    const shared = [
      { ...poseA, ebayItemId: "157999999999" },
      { ...poseB, ebayItemId: "157999999999" },
    ];
    const result = resolveOrderItemProductMatch(
      orderItem({ legacyItemId: "157999999999" }),
      shared,
    );
    expect(result.matchedBy).not.toBe("item_id");
  });

  it("상품번호가 없는 주문은 예전 방식대로 처리한다", () => {
    const result = resolveOrderItemProductMatch(orderItem({}), products);
    expect(result.matchedBy).not.toBe("item_id");
  });
});
