import { describe, expect, it } from "vitest";
import { listingQuantity } from "@/lib/listing-quantity";

// eBay에 올리는 수량 = 내 재고 + 포카마켓에서 조달 가능한 수량.
// 신규등록 파일과 가격·수량 변경 파일이 같은 값을 써야 등록 직후 수량이
// 다음 날 바뀌는 일이 없다.

describe("리스팅 수량", () => {
  it("내 재고와 포카 빠른구매 가능 수량 전체를 더한다", () => {
    expect(
      listingQuantity({ stockQuantity: 2, pocamarketAvailableCount: 5 }),
    ).toBe(7);
  });

  it("내 재고만 있으면 그 수량", () => {
    expect(
      listingQuantity({ stockQuantity: 1, pocamarketAvailableCount: 0 }),
    ).toBe(1);
  });

  it("포카 매물만 있으면 그 수량", () => {
    expect(
      listingQuantity({ stockQuantity: 0, pocamarketAvailableCount: 5 }),
    ).toBe(5);
  });

  it("포카 매물 정보가 없으면 내 재고만 센다", () => {
    expect(
      listingQuantity({ stockQuantity: 3, pocamarketAvailableCount: null }),
    ).toBe(3);
  });

  it("템플릿 기본값으로 재고 없는 상품을 되살리지 않는다", () => {
    expect(listingQuantity({ stockQuantity: 1, pocamarketAvailableCount: 0 }, 5)).toBe(1);
    expect(listingQuantity({ stockQuantity: 0, pocamarketAvailableCount: 0 }, 5)).toBe(0);
  });

  it("음수 재고는 0으로 본다", () => {
    expect(
      listingQuantity({ stockQuantity: -2, pocamarketAvailableCount: 4 }),
    ).toBe(4);
  });
});
