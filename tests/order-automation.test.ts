import { describe, expect, it } from "vitest";
import { getOrderAutomationState } from "../src/lib/order-automation";

function baseOrder() {
  return {
    fulfillmentStatus: "NOT_STARTED",
    shipByDate: null,
    items: [],
    shipments: [],
  };
}

describe("getOrderAutomationState", () => {
  it("flags unmatched order items as critical", () => {
    expect(
      getOrderAutomationState({
        ...baseOrder(),
        items: [
          {
            productId: null,
            stockDeducted: false,
            quantity: 1,
            product: null,
          },
        ],
      }),
    ).toMatchObject({
      tags: ["미매칭"],
      warningLevel: "critical",
      warningMessage: "상품 미매칭 1건",
    });
  });

  it("flags open orders due within 24 hours as warning", () => {
    expect(
      getOrderAutomationState(
        {
          ...baseOrder(),
          shipByDate: new Date("2026-05-07T00:00:00.000Z"),
        },
        new Date("2026-05-06T12:00:00.000Z"),
      ),
    ).toMatchObject({
      tags: ["배송마감임박"],
      warningLevel: "warning",
    });
  });
});
