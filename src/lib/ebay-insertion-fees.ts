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
 * 가격 계산에 넣을 등록수수료를 정하는 기준 기간.
 *
 * "이번 달에 청구가 있었나"로 보면 안 된다. eBay 스토어 약관은 달 중간에 구독해도 그
 * 달의 무료 등록 할당량을 통째로 새로 준다고 밝히고 있다("You receive your entire ZIF
 * allotment for the calendar month when you sign up, regardless of when you sign up").
 * 그래서 구독 전에 청구된 건이 같은 달에 남아 있어도 지금은 무료일 수 있다. 달 전체가
 * 아니라 최근 며칠을 봐야 구독·한도 변화를 따라간다.
 */
export const INSERTION_FEE_SIGNAL_DAYS = 7;

/**
 * 가격 계산에 넣을 등록수수료.
 *
 * 최근 며칠 안에 실제로 청구가 있었으면 지금도 할당량 밖이므로 그 단가를 판매가에
 * 얹는다. 청구가 멎었으면 0이다. 판단 근거는 언제나 정산에 찍힌 청구뿐이고, 할당량
 * 잔여를 추측해서 정하지 않는다.
 */
export function recommendedInsertionFeeUsd(
  charges: InsertionCharge[],
  now: Date = new Date(),
) {
  const insertion = charges.filter(
    (charge) => charge.feeType === "INSERTION_FEE" && charge.amount > 0,
  );
  const since = new Date(now.getTime() - INSERTION_FEE_SIGNAL_DAYS * 24 * 60 * 60 * 1000);
  const recent = insertion.filter((charge) => new Date(charge.date) >= since);
  const unitOf = (rows: InsertionCharge[]) =>
    rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.amount, 0) / rows.length).toFixed(2))
      : null;
  // 최근 청구가 없어도 단가는 마지막으로 청구된 날의 값으로 알 수 있다. 설명에만 쓴다.
  const lastDate = insertion.map((charge) => charge.date).sort().at(-1);
  const knownUnitUsd =
    unitOf(recent) ?? unitOf(insertion.filter((charge) => charge.date === lastDate));
  return {
    /** 판매가에 얹을 금액 */
    usd: recent.length > 0 ? (unitOf(recent) ?? 0) : 0,
    /** 최근에 확인된 건당 단가. 화면 설명용이다. */
    knownUnitUsd,
    /** 지금도 할당량 밖인지. 최근 며칠 안의 실제 청구로만 판단한다. */
    allowanceExhausted: recent.length > 0,
    /** 판단에 쓴 최근 청구 건수 */
    recentChargedCount: recent.length,
    signalDays: INSERTION_FEE_SIGNAL_DAYS,
    /** 마지막으로 등록수수료가 청구된 날 */
    lastChargedDate: lastDate ?? null,
  };
}
