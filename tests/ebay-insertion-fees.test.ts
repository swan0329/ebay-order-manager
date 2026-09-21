import { describe, expect, it } from "vitest";
import { chargedListingIds, summarizeInsertionFees } from "@/lib/ebay-insertion-fees";

const now = new Date("2026-09-21T00:00:00.000Z");

describe("summarizeInsertionFees", () => {
  it("eBay 정산에 찍힌 INSERTION_FEE만 합산한다", () => {
    const summary = summarizeInsertionFees(
      [
        { date: "2026-09-11", feeType: "INSERTION_FEE", amount: 0.35 },
        { date: "2026-09-12", feeType: "INSERTION_FEE", amount: 0.35 },
        { date: "2026-09-12", feeType: "AD_FEE", amount: 4.25 },
        { date: "2026-08-30", feeType: "INSERTION_FEE", amount: 0.35 },
      ],
      now,
    );
    expect(summary.month).toBe("2026-09");
    expect(summary.chargedCount).toBe(2);
    expect(summary.amount).toBe(0.7);
    expect(summary.perChargeUsd).toBe(0.35);
    expect(summary.months).toEqual([
      { month: "2026-08", count: 1, refunded: 0, amount: 0.35 },
      { month: "2026-09", count: 2, refunded: 0, amount: 0.7 },
    ]);
  });

  it("환급은 건수에서 빼고 금액에서 상계한다", () => {
    const summary = summarizeInsertionFees(
      [
        { date: "2026-09-11", feeType: "INSERTION_FEE", amount: 0.35 },
        { date: "2026-09-13", feeType: "INSERTION_FEE", amount: -0.35 },
      ],
      now,
    );
    expect(summary.chargedCount).toBe(1);
    expect(summary.refundedCount).toBe(1);
    expect(summary.amount).toBe(0);
    expect(summary.recentCount).toBe(1);
    expect(summary.recentAmount).toBe(0);
  });

  it("청구가 없으면 0으로 두고 건당 단가를 지어내지 않는다", () => {
    const summary = summarizeInsertionFees([], now);
    expect(summary.chargedCount).toBe(0);
    expect(summary.amount).toBe(0);
    expect(summary.perChargeUsd).toBeNull();
    expect(summary.months).toEqual([]);
  });

  it("최근 30일 밖의 청구는 최근 합계에서 뺀다", () => {
    const summary = summarizeInsertionFees(
      [
        { date: "2026-09-20", feeType: "INSERTION_FEE", amount: 0.35 },
        { date: "2026-07-01", feeType: "INSERTION_FEE", amount: 0.35 },
      ],
      now,
    );
    expect(summary.recentCount).toBe(1);
    expect(summary.recentAmount).toBe(0.35);
  });
});

describe("chargedListingIds", () => {
  it("청구 거래의 리스팅 번호를 뽑는다", () => {
    expect(
      chargedListingIds([
        { references: [{ referenceId: "285000000001", referenceType: "ITEM_ID" }] },
        { references: [{ referenceId: "285000000002" }, { referenceId: "" }] },
        { references: null },
      ]),
    ).toEqual(["285000000001", "285000000002"]);
  });
});
