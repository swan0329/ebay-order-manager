import { describe, expect, it } from "vitest";

// 신규등록 CSV에 실리는 수량 규칙. 실제 보유 수량이 템플릿 기본값보다 우선해야
// 한다 — 1장 가진 카드가 여러 장으로 올라가면 초과 판매가 난다.
function listingQuantity(
  product: { stockQuantity: number; pocamarketAvailableCount: number | null },
  templateDefaultQuantity: number | null,
  fallback: number,
) {
  return product.stockQuantity > 0
    ? product.stockQuantity
    : (product.pocamarketAvailableCount ?? 0) > 0
      ? 1
      : templateDefaultQuantity ?? fallback;
}

describe("신규등록 수량", () => {
  it("내 재고가 있으면 실제 수량을 쓴다", () => {
    expect(listingQuantity({ stockQuantity: 1, pocamarketAvailableCount: 0 }, 5, 0)).toBe(1);
    expect(listingQuantity({ stockQuantity: 4, pocamarketAvailableCount: 0 }, 5, 0)).toBe(4);
  });

  it("템플릿 기본 수량이 실제 재고를 덮지 않는다", () => {
    // 1장뿐인데 5로 올라가면 4장을 초과 판매하게 된다.
    expect(listingQuantity({ stockQuantity: 1, pocamarketAvailableCount: 0 }, 5, 0)).not.toBe(5);
  });

  it("포카마켓 조달분은 1로 묶는다", () => {
    // 매물이 다음 동기화 전에 사라질 수 있어 여러 장을 약속하지 않는다.
    expect(listingQuantity({ stockQuantity: 0, pocamarketAvailableCount: 9 }, 5, 0)).toBe(1);
  });

  it("어느 재고 신호도 없을 때만 템플릿 기본값을 쓴다", () => {
    expect(listingQuantity({ stockQuantity: 0, pocamarketAvailableCount: 0 }, 5, 0)).toBe(5);
  });
});
