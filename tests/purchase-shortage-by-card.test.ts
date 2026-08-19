import { describe, expect, it } from "vitest";

// createPurchaseJobs 안에서 쓰는 집계 규칙과 같은 계산이다. 주문 줄이 아니라
// 카드 단위로 필요량을 합친 뒤 재고를 한 번만 뺀다.
type Line = { productId: string; quantity: number; stockQuantity: number };

function shortageByCard(lines: Line[]) {
  const byProduct = new Map<string, { needed: number; stock: number }>();
  for (const line of lines) {
    const current = byProduct.get(line.productId);
    if (current) {
      current.needed += line.quantity;
      continue;
    }
    byProduct.set(line.productId, { needed: line.quantity, stock: line.stockQuantity });
  }
  return [...byProduct.entries()]
    .map(([productId, value]) => ({ productId, missing: value.needed - value.stock }))
    .filter((card) => card.missing > 0);
}

describe("재고 부족을 카드 단위로 센다", () => {
  it("같은 카드가 두 줄이면 필요량을 합쳐서 판단한다", () => {
    // 재고 1장에 각 1장씩 필요하면 실제로는 1장 부족이다. 줄마다 따로 비교하면
    // 둘 다 부족이 아니라고 보고 아무것도 사지 않았다.
    const result = shortageByCard([
      { productId: "card-a", quantity: 1, stockQuantity: 1 },
      { productId: "card-a", quantity: 1, stockQuantity: 1 },
    ]);
    expect(result).toEqual([{ productId: "card-a", missing: 1 }]);
  });

  it("재고가 없으면 한 카드를 두 건으로 세지 않는다", () => {
    // 예전에는 줄마다 부족으로 잡아 같은 카드가 2건으로 보였다.
    const result = shortageByCard([
      { productId: "card-a", quantity: 1, stockQuantity: 0 },
      { productId: "card-a", quantity: 1, stockQuantity: 0 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].missing).toBe(2);
  });

  it("재고가 넉넉하면 부족으로 잡지 않는다", () => {
    expect(
      shortageByCard([
        { productId: "card-a", quantity: 1, stockQuantity: 3 },
        { productId: "card-a", quantity: 1, stockQuantity: 3 },
      ]),
    ).toEqual([]);
  });

  it("서로 다른 카드는 따로 센다", () => {
    const result = shortageByCard([
      { productId: "card-a", quantity: 2, stockQuantity: 0 },
      { productId: "card-b", quantity: 1, stockQuantity: 1 },
      { productId: "card-c", quantity: 1, stockQuantity: 0 },
    ]);
    expect(result).toEqual([
      { productId: "card-a", missing: 2 },
      { productId: "card-c", missing: 1 },
    ]);
  });
});
