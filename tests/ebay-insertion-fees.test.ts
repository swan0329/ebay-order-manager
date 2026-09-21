import { describe, expect, it } from "vitest";
import { chargedListingIds, recommendedInsertionFeeUsd, summarizeInsertionFees } from "@/lib/ebay-insertion-fees";

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

describe("recommendedInsertionFeeUsd", () => {
  it("최근에 청구가 있으면 그 단가를 판매가에 얹는다", () => {
    const result = recommendedInsertionFeeUsd(
      [{ date: "2026-09-20", feeType: "INSERTION_FEE", amount: 0.35 }],
      now,
    );
    expect(result.usd).toBe(0.35);
    expect(result.allowanceExhausted).toBe(true);
    expect(result.recentChargedCount).toBe(1);
  });

  // 달 중간에 스토어를 구독하면 그 달 할당량을 통째로 새로 받는다. 같은 달 앞부분의
  // 청구가 남아 있어도 지금은 무료일 수 있으므로 판매가에 얹으면 안 된다.
  it("구독 전 같은 달 청구는 판매가에 얹지 않는다", () => {
    const result = recommendedInsertionFeeUsd(
      [
        { date: "2026-09-11", feeType: "INSERTION_FEE", amount: 0.35 },
        { date: "2026-09-12", feeType: "INSERTION_FEE", amount: 0.35 },
      ],
      now,
    );
    expect(result.usd).toBe(0);
    expect(result.allowanceExhausted).toBe(false);
    expect(result.knownUnitUsd).toBe(0.35);
    expect(result.lastChargedDate).toBe("2026-09-12");
  });

  it("청구 기록이 아예 없으면 단가를 지어내지 않는다", () => {
    expect(recommendedInsertionFeeUsd([], now)).toMatchObject({
      usd: 0,
      knownUnitUsd: null,
      allowanceExhausted: false,
      lastChargedDate: null,
    });
  });

  it("환급은 청구 신호로 세지 않는다", () => {
    const result = recommendedInsertionFeeUsd(
      [{ date: "2026-09-20", feeType: "INSERTION_FEE", amount: -0.35 }],
      now,
    );
    expect(result.usd).toBe(0);
    expect(result.allowanceExhausted).toBe(false);
  });

  it("다른 수수료 항목은 보지 않는다", () => {
    const result = recommendedInsertionFeeUsd(
      [{ date: "2026-09-20", feeType: "AD_FEE", amount: 4.25 }],
      now,
    );
    expect(result.usd).toBe(0);
    expect(result.allowanceExhausted).toBe(false);
  });
});
