import { getActiveEbayAccount } from "@/lib/services/ebayApiService";
import { getOrdersFromEbay } from "@/lib/ebay";
import { getFinanceFeeBreakdown } from "@/lib/services/ebayFinanceService";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

function amount(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as { value?: unknown };
  const parsed = Number(record.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * eBay가 주문마다 실제로 뗀 수수료를 그대로 읽어 온다. 우리 가격 계산에 넣어 둔
 * 수수료율이 현실과 맞는지는 추정이 아니라 정산 숫자로 확인해야 한다. 읽기만 한다.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 90)));
    // 정산 기준 항목별 내역. 광고비·구독료처럼 주문에 딸리지 않는 비용까지 보인다.
    if (url.searchParams.get("source") === "finances")
      return Response.json({
        ok: true,
        ...(await getFinanceFeeBreakdown(user.id, days, url.searchParams.get("detail") === "1")),
      });
    const account = await getActiveEbayAccount(user.id);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const body = await getOrdersFromEbay(account, { creationDateFrom: from }, limit, 0);
    const orders = (body.orders ?? []).map((raw) => {
      const order = record(raw);
      const pricing = record(order.pricingSummary);
      const total = amount(pricing.total);
      const fee = amount(order.totalMarketplaceFee);
      const basis = amount(order.totalFeeBasisAmount);
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
      return {
        orderId: order.orderId,
        createdAt: order.creationDate,
        itemSubtotal: amount(pricing.priceSubtotal),
        deliveryCost: amount(pricing.deliveryCost),
        tax: amount(pricing.tax),
        total,
        feeBasis: basis,
        marketplaceFee: fee,
        feeRateOfTotal: total && fee ? Number(((fee / total) * 100).toFixed(2)) : null,
        feeRateOfBasis: basis && fee ? Number(((fee / basis) * 100).toFixed(2)) : null,
        skus: lineItems.map((item) => record(item).sku ?? null),
        // 항목별로 수수료 종류가 나오면 무엇을 얼마나 뗐는지 그대로 보여 준다.
        lineItemFees: lineItems.flatMap((item) => {
          const fees = record(item).marketplaceFees;
          return Array.isArray(fees)
            ? fees.map((entry) => ({
                type: record(entry).feeType ?? null,
                amount: amount(record(entry).amount),
              }))
            : [];
        }),
      };
    });
    const withFee = orders.filter((order) => order.marketplaceFee !== null);
    const totalSale = withFee.reduce((sum, order) => sum + (order.total ?? 0), 0);
    const totalFee = withFee.reduce((sum, order) => sum + (order.marketplaceFee ?? 0), 0);
    return Response.json({
      ok: true,
      scanned: orders.length,
      withFee: withFee.length,
      totalSale: Number(totalSale.toFixed(2)),
      totalFee: Number(totalFee.toFixed(2)),
      averageFeeRate: totalSale ? Number(((totalFee / totalSale) * 100).toFixed(2)) : null,
      orders,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
