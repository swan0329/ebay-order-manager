import { accountHasScope, ebayApiRequest, getActiveEbayAccount, sellFinancesScope } from "@/lib/services/ebayApiService";

type Money = { value?: unknown; currency?: unknown };

function amount(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const parsed = Number((value as Money).value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export type FeeBreakdownRow = {
  /** eBay가 붙인 항목 이름 그대로 쓴다. 우리가 지어낸 이름으로 바꾸지 않는다. */
  feeType: string;
  count: number;
  amount: number;
};

/**
 * eBay가 실제로 떼 간 금액을 항목별로 읽는다. 주문 API의 합계만 보면 광고비·구독료처럼
 * 주문에 딸리지 않는 비용이 빠져 실제 정산과 어긋난다. 읽기만 하며 아무것도 바꾸지 않는다.
 */
export async function getFinanceFeeBreakdown(userId: string, days: number) {
  const account = await getActiveEbayAccount(userId);
  if (!accountHasScope(account, sellFinancesScope)) {
    throw new Error(
      "이 eBay 연결에는 정산(Finances) 권한이 없습니다. 연결 화면에서 다시 연결해 권한을 받아 주세요.",
    );
  }
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();
  const transactions: Record<string, unknown>[] = [];
  let offset = 0;
  // 한 번에 200건까지만 준다. 기간 안의 것을 모두 모은다.
  for (let page = 0; page < 20; page += 1) {
    const result = await ebayApiRequest(account, {
      host: "identity",
      path: "/sell/finances/v1/transaction",
      query: {
        filter: `transactionDate:[${from}..${to}]`,
        limit: 200,
        offset,
      },
    });
    const body = record(result.body);
    const page_ = Array.isArray(body.transactions) ? body.transactions : [];
    transactions.push(...page_.map(record));
    offset += page_.length;
    if (page_.length < 200 || offset >= Number(body.total ?? 0)) break;
  }

  const fees = new Map<string, FeeBreakdownRow>();
  const addFee = (feeType: string, value: number) => {
    const key = feeType || "UNKNOWN";
    const row = fees.get(key) ?? { feeType: key, count: 0, amount: 0 };
    row.count += 1;
    row.amount += value;
    fees.set(key, row);
  };
  const byType = new Map<string, { count: number; amount: number }>();
  let saleTotal = 0;
  let saleFeeBasis = 0;

  for (const transaction of transactions) {
    const type = text(transaction.transactionType) || "UNKNOWN";
    const value = amount(transaction.amount);
    const entry = byType.get(type) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += value;
    byType.set(type, entry);

    if (type === "SALE") {
      saleTotal += value;
      saleFeeBasis += amount(transaction.totalFeeBasisAmount);
      const lineItems = Array.isArray(transaction.orderLineItems)
        ? transaction.orderLineItems
        : [];
      for (const rawLine of lineItems) {
        const line = record(rawLine);
        const marketplaceFees = Array.isArray(line.marketplaceFees) ? line.marketplaceFees : [];
        for (const rawFee of marketplaceFees) {
          const fee = record(rawFee);
          addFee(text(fee.feeType), amount(fee.amount));
        }
      }
    }
    // 광고비·구독료처럼 주문에 딸리지 않는 비용은 별도 거래로 내려온다.
    if (type === "NON_SALE_CHARGE") {
      const feeTypes = Array.isArray(transaction.feeType)
        ? transaction.feeType
        : [transaction.feeType];
      for (const feeType of feeTypes) addFee(text(feeType) || "NON_SALE_CHARGE", value);
    }
  }

  return {
    days,
    transactionCount: transactions.length,
    byTransactionType: [...byType.entries()]
      .map(([type, value]) => ({ type, ...value, amount: Number(value.amount.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    saleTotal: Number(saleTotal.toFixed(2)),
    saleFeeBasis: Number(saleFeeBasis.toFixed(2)),
    fees: [...fees.values()]
      .map((row) => ({ ...row, amount: Number(row.amount.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
  };
}
