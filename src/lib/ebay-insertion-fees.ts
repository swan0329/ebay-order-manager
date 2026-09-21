/**
 * 등록수수료(INSERTION_FEE) 집계.
 *
 * eBay 정산(Sell Finances API `GET /sell/finances/v1/transaction`)에서 읽은
 * `NON_SALE_CHARGE` 거래 가운데 `feeType`이 `INSERTION_FEE`인 것만 센다.
 *
 * 하지 않는 것: 계정의 판매 한도(Selling Limit)나 우리가 올린 리스팅 수로 무료 등록
 * 한도·예상 청구액을 만들지 않는다. 판매 한도(50,000개 / $500,000)는 팔 수 있는 상한일
 * 뿐 무료 등록 한도가 아니다.
 *
 * 이 계정은 스토어 미구독(No Store)이고 그런 계정의 무료 등록(Zero Insertion Fee)
 * 할당량은 보통 월 250건, 일반 카테고리 초과분은 건당 $0.35로 알려져 있다. 그래도 이
 * 숫자로 예상 청구액을 만들지 않는다. Good 'Til Cancelled 리스팅이 다음 달로 자동
 * 갱신될 때도 할당량을 쓰고 등록수수료가 붙기 때문에, 우리가 새로 올린 건수만으로는
 * 청구를 맞힐 수 없다. 확인되지 않으면 "확인 불가"로 남긴다.
 */
export type InsertionCharge = {
  /** 정산 거래일(UTC) `YYYY-MM-DD` */
  date: string;
  feeType: string;
  /** 청구는 양수, 환급(CREDIT)은 음수 */
  amount: number;
};

export type InsertionFeeMonth = {
  month: string;
  count: number;
  refunded: number;
  amount: number;
};

export type InsertionFeeSummary = {
  month: string;
  chargedCount: number;
  refundedCount: number;
  amount: number;
  perChargeUsd: number | null;
  recentCount: number;
  recentAmount: number;
  months: InsertionFeeMonth[];
};

const round = (value: number) => Number(value.toFixed(2));

export function summarizeInsertionFees(
  charges: InsertionCharge[],
  now: Date = new Date(),
  recentDays = 30,
): InsertionFeeSummary {
  const insertion = charges.filter((charge) => charge.feeType === "INSERTION_FEE");
  const byMonth = new Map<string, { charged: number; refunded: number; amount: number }>();
  for (const charge of insertion) {
    const key = charge.date.slice(0, 7);
    const row = byMonth.get(key) ?? { charged: 0, refunded: 0, amount: 0 };
    // 같은 항목 이름으로 환급이 내려온다. 방향을 나눠 세지 않으면 취소된 등록까지
    // 청구 건수로 잡힌다.
    if (charge.amount < 0) row.refunded += 1;
    else row.charged += 1;
    row.amount += charge.amount;
    byMonth.set(key, row);
  }

  // 정산 거래일은 UTC로 내려온다. 이번 달 기준도 같은 시간대로 잡아야 달이 어긋나지 않는다.
  const month = now.toISOString().slice(0, 7);
  const thisMonth = byMonth.get(month) ?? { charged: 0, refunded: 0, amount: 0 };
  const since = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000);
  const recent = insertion.filter((charge) => new Date(charge.date) >= since);

  return {
    month,
    chargedCount: thisMonth.charged,
    refundedCount: thisMonth.refunded,
    amount: round(thisMonth.amount),
    perChargeUsd: thisMonth.charged > 0 ? round(thisMonth.amount / thisMonth.charged) : null,
    recentCount: recent.filter((charge) => charge.amount >= 0).length,
    recentAmount: round(recent.reduce((sum, charge) => sum + charge.amount, 0)),
    months: [...byMonth.entries()]
      .map(([key, value]) => ({
        month: key,
        count: value.charged,
        refunded: value.refunded,
        amount: round(value.amount),
      }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/** 정산 거래 원본에서 어떤 리스팅에 붙었는지 번호만 뽑는다. 사람이 eBay에서 직접 대조한다. */
export function chargedListingIds(raw: Array<Record<string, unknown>>, limit = 10) {
  return raw
    .flatMap((transaction) =>
      Array.isArray(transaction.references) ? transaction.references : [],
    )
    .map((reference) => String((reference as { referenceId?: string }).referenceId ?? ""))
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * 가격 계산에 넣을 등록수수료.
 *
 * 이번 달 정산에 등록수수료 청구가 있으면 무료 할당량을 이미 다 쓴 달이므로, 지금
 * 올리는 리스팅에도 같은 단가가 붙는다. 그 단가를 그대로 쓴다. 청구가 없으면 아직
 * 무료 구간이므로 0이다.
 *
 * 이번 달 청구가 없더라도 지난 달에 청구가 있었다면 단가만 참고로 돌려준다. 가격에
 * 넣을 금액(usd)은 어디까지나 이번 달 실제 청구 여부로 정한다.
 */
export function recommendedInsertionFeeUsd(summary: InsertionFeeSummary) {
  const lastCharged = [...summary.months].reverse().find((month) => month.count > 0);
  const knownUnitUsd =
    summary.perChargeUsd ??
    (lastCharged ? Number((lastCharged.amount / lastCharged.count).toFixed(2)) : null);
  return {
    /** 판매가에 얹을 금액 */
    usd: summary.chargedCount > 0 ? (summary.perChargeUsd ?? 0) : 0,
    /** 최근에 확인된 건당 단가. 화면 설명용이다. */
    knownUnitUsd,
    /** 이번 달 무료 할당량을 다 썼는지. 청구가 한 건이라도 있으면 다 쓴 것이다. */
    allowanceExhausted: summary.chargedCount > 0,
  };
}
