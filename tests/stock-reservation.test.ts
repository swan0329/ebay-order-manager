import { describe, expect, it } from "vitest";
import {
  availabilityForOrder,
  reservedByProduct,
  sellableQuantity,
} from "@/lib/stock-reservation";

const line = (over: Partial<Parameters<typeof reservedByProduct>[0][number]> = {}) => ({
  productId: "card-a",
  quantity: 1,
  stockDeducted: false,
  orderCancelled: false,
  ...over,
});

describe("예약 수량 세기", () => {
  it("아직 빼지 않은 주문 수량을 카드별로 합친다", () => {
    const reserved = reservedByProduct([
      line(),
      line({ quantity: 2 }),
      line({ productId: "card-b" }),
    ]);
    expect(reserved.get("card-a")).toBe(3);
    expect(reserved.get("card-b")).toBe(1);
  });

  it("이미 차감한 줄은 세지 않는다", () => {
    // 재고에서 이미 빠졌다. 또 세면 있는 재고를 없다고 보게 된다.
    expect(reservedByProduct([line({ stockDeducted: true })]).get("card-a")).toBeUndefined();
  });

  it("취소된 주문은 잡아 두지 않는다", () => {
    expect(reservedByProduct([line({ orderCancelled: true })]).get("card-a")).toBeUndefined();
  });
});

describe("한 주문이 쓸 수 있는 수량", () => {
  it("자기 예약은 자기와 겨루지 않는다", () => {
    // 재고 1, 이 주문이 1장 필요. 다른 주문은 없다. 모자라지 않아야 한다.
    expect(
      availabilityForOrder({ stock: 1, totalReserved: 1, neededByThisOrder: 1 }),
    ).toMatchObject({ reservedByOthers: 0, available: 1, missing: 0 });
  });

  it("다른 주문이 먼저 잡아 두면 모자란다", () => {
    // 재고 1, 두 주문이 각 1장. 한 장은 남의 몫이라 이 주문은 못 쓴다.
    expect(
      availabilityForOrder({ stock: 1, totalReserved: 2, neededByThisOrder: 1 }),
    ).toMatchObject({ reservedByOthers: 1, available: 0, missing: 1 });
  });

  it("재고가 넉넉하면 둘 다 쓸 수 있다", () => {
    expect(
      availabilityForOrder({ stock: 5, totalReserved: 3, neededByThisOrder: 1 }),
    ).toMatchObject({ available: 3, missing: 0 });
  });

  it("재고가 아예 없으면 필요한 만큼 모자라다", () => {
    expect(
      availabilityForOrder({ stock: 0, totalReserved: 2, neededByThisOrder: 2 }),
    ).toMatchObject({ available: 0, missing: 2 });
  });
});

describe("채널에 올릴 판매 가능 수량", () => {
  it("예약된 몫을 빼고 올린다", () => {
    // 빼지 않으면 같은 카드가 두 채널에서 동시에 팔린다.
    expect(sellableQuantity({ stock: 3, reserved: 1 })).toBe(2);
  });

  it("이전 안전재고 값은 판매 가능 수량에 영향을 주지 않는다", () => {
    expect(sellableQuantity({ stock: 3, reserved: 1 })).toBe(2);
  });

  it("음수가 되지 않는다", () => {
    expect(sellableQuantity({ stock: 1, reserved: 5 })).toBe(0);
  });
});
