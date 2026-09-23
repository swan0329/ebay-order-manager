import { describe, expect, it } from "vitest";
import { planProductPurchaseShortages } from "./pocamarket-purchases";

describe("planProductPurchaseShortages", () => {
  const demands = [
    { orderId: "o1", orderItemId: "i1", quantity: 2 },
    { orderId: "o2", orderItemId: "i2", quantity: 2 },
  ];

  it("allocates current stock to older order items before requesting purchases", () => {
    expect(planProductPurchaseShortages(demands, 3, new Map())).toEqual([
      { ...demands[1], requestedQuantity: 1 },
    ]);
  });

  it("does not request quantities already covered by active or completed jobs", () => {
    expect(
      planProductPurchaseShortages(demands, 1, new Map([["i2", 2]])),
    ).toEqual([{ ...demands[0], requestedQuantity: 1 }]);
  });

  it("never creates a request when stock covers all demand", () => {
    expect(planProductPurchaseShortages(demands, 4, new Map())).toEqual([]);
  });
});
