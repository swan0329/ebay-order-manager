import { describe, expect, it } from "vitest";
import { reservedByProduct, sellableQuantity } from "@/lib/stock-reservation";

// 채널에 올릴 수량을 정하는 규칙. 실제 밀어넣기는 Shopify를 부르므로 여기서는
// 무엇을 올릴지 정하는 계산만 확인한다.
function planFor(input: {
  stock: number;
  safetyStock: number;
  lines: Array<{ quantity: number; stockDeducted: boolean; orderCancelled: boolean }>;
}) {
  const reserved =
    reservedByProduct(input.lines.map((line) => ({ productId: "card", ...line }))).get("card") ?? 0;
  return {
    reserved,
    sellable: sellableQuantity({
      stock: input.stock,
      reserved,
      safetyStock: input.safetyStock,
    }),
  };
}

describe("채널에 올릴 수량 정하기", () => {
  it("처리 안 된 주문이 잡아 둔 만큼 빼고 올린다", () => {
    // 재고 3장 중 1장은 이미 팔린 주문 몫이다. 3장으로 올리면 없는 카드가 팔린다.
    expect(
      planFor({
        stock: 3,
        safetyStock: 0,
        lines: [{ quantity: 1, stockDeducted: false, orderCancelled: false }],
      }),
    ).toEqual({ reserved: 1, sellable: 2 });
  });

  it("이미 재고를 뺀 주문은 두 번 세지 않는다", () => {
    // 재고에서 이미 빠졌다. 또 빼면 팔 수 있는 카드를 못 팔게 된다.
    expect(
      planFor({
        stock: 3,
        safetyStock: 0,
        lines: [{ quantity: 1, stockDeducted: true, orderCancelled: false }],
      }),
    ).toEqual({ reserved: 0, sellable: 3 });
  });

  it("취소된 주문은 잡아 두지 않는다", () => {
    expect(
      planFor({
        stock: 2,
        safetyStock: 0,
        lines: [{ quantity: 2, stockDeducted: false, orderCancelled: true }],
      }),
    ).toEqual({ reserved: 0, sellable: 2 });
  });

  it("안전재고를 두면 그만큼 낮춰 올린다", () => {
    // eBay는 수량 반영이 파일이라 늦다. 그 사이 겹쳐 팔리는 것을 막는 여유다.
    expect(
      planFor({
        stock: 3,
        safetyStock: 1,
        lines: [{ quantity: 1, stockDeducted: false, orderCancelled: false }],
      }),
    ).toEqual({ reserved: 1, sellable: 1 });
  });

  it("잡아 둔 몫이 재고보다 많으면 0으로 내린다", () => {
    // 초과 판매가 이미 일어난 상태다. 더 팔리지 않게 막아야 한다.
    expect(
      planFor({
        stock: 1,
        safetyStock: 0,
        lines: [
          { quantity: 1, stockDeducted: false, orderCancelled: false },
          { quantity: 2, stockDeducted: false, orderCancelled: false },
        ],
      }),
    ).toEqual({ reserved: 3, sellable: 0 });
  });
});
