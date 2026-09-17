export type OrderItemSale = {
  unitAmount: number;
  lineAmount: number;
  currency: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function money(value: unknown) {
  const r = record(value);
  const raw = r.value ?? r.amount;
  const currency = r.currency ?? r.currencyCode;
  if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 && typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
    ? { amount, currency } : null;
}

/** Historical merchandise price only; never substitute today's catalog price or shipping-inclusive total. */
export function orderItemSale(raw: unknown, quantity: number, channel: "EBAY" | "SHOPIFY"): OrderItemSale | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  const r = record(raw);
  if (channel === "EBAY") {
    const price = money(r.discountedLineItemCost ?? r.lineItemCost);
    return price ? { lineAmount: price.amount, unitAmount: price.amount / quantity, currency: price.currency } : null;
  }
  const original = money(record(r.originalTotalSet).shopMoney);
  if (!original || !Array.isArray(r.discountAllocations)) return null;
  let discount = 0;
  for (const allocation of r.discountAllocations) {
    const value = money(record(record(allocation).allocatedAmountSet).shopMoney);
    if (!value || value.currency !== original.currency) return null;
    discount += value.amount;
  }
  const lineAmount = Math.round((original.amount - discount) * 100) / 100;
  return lineAmount >= 0 ? { lineAmount, unitAmount: lineAmount / quantity, currency: original.currency } : null;
}

export function orderMerchandiseTotal(sales: (OrderItemSale | null)[], currency: string): number | null {
  if (!sales.length || sales.some(sale => !sale || sale.currency !== currency)) return null;
  return Math.round(sales.reduce((sum, sale) => sum + sale!.lineAmount, 0) * 100) / 100;
}

export function formatOrderMoney(amount: number | string, currency: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "금액 미확인";
  return `${value.toLocaleString("ko-KR", { minimumFractionDigits: currency === "KRW" ? 0 : 2, maximumFractionDigits: currency === "KRW" ? 0 : 2 })} ${currency}`;
}

export function soldBelowCurrentCost(sale: OrderItemSale | null, costKrw: number | null, exchangeRate: number | null) {
  return Boolean(sale?.currency === "USD" && costKrw !== null && costKrw > 0
    && exchangeRate !== null && Number.isFinite(exchangeRate) && exchangeRate > 0
    && sale.unitAmount * exchangeRate < costKrw);
}
