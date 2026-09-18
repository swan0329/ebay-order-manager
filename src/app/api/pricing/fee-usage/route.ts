import { getOrdersFromEbay } from "@/lib/ebay";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getActiveEbayAccount } from "@/lib/services/ebayApiService";
import { getFinanceFeeBreakdown } from "@/lib/services/ebayFinanceService";

export const maxDuration = 60;

function money(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const parsed = Number((value as { value?: unknown }).value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * eBay가 실제로 떼 간 수수료와 등록 사용량을 한 번에 돌려준다. 가격 설정에 넣어 둔
 * 숫자가 현실과 맞는지 사람이 화면에서 바로 대조할 수 있어야 한다. 읽기만 한다.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const days = Math.min(365, Math.max(30, Number(url.searchParams.get("days") ?? 180)));
    const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
    const allowance = settings?.freeListingAllowance ?? 250;

    const finance = await getFinanceFeeBreakdown(user.id, days, true);
    const account = await getActiveEbayAccount(user.id);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const orderBody = await getOrdersFromEbay(account, { creationDateFrom: from }, 200, 0);
    const orders = (orderBody.orders ?? []) as Array<Record<string, unknown>>;

    // 수수료가 실제로 걸린 금액. 상품값에 배송비와 eBay가 걷은 판매세까지 들어 있다.
    let feeBasis = 0;
    let buyerPaid = 0;
    let itemSubtotal = 0;
    let shipping = 0;
    for (const order of orders) {
      const pricing = (order.pricingSummary ?? {}) as Record<string, unknown>;
      feeBasis += money(order.totalFeeBasisAmount);
      buyerPaid += money(pricing.total);
      itemSubtotal += money(pricing.priceSubtotal);
      shipping += Math.max(0, money(pricing.total) - money(pricing.priceSubtotal));
    }

    const feeOf = (type: string) =>
      finance.fees.find((row) => row.feeType === type)?.amount ?? 0;
    const finalValue = feeOf("FINAL_VALUE_FEE");
    const international = feeOf("INTERNATIONAL_FEE");
    const perOrder = feeOf("FINAL_VALUE_FEE_FIXED_PER_ORDER");
    const advertising = feeOf("AD_FEE");
    const insertion = feeOf("INSERTION_FEE");

    // 등록수수료는 월마다 무료 한도를 넘긴 만큼만 청구된다. 달별로 나눠 보여 준다.
    const byMonth = new Map<string, { count: number; amount: number }>();
    for (const charge of finance.charges ?? []) {
      if (charge.feeType !== "INSERTION_FEE") continue;
      const key = charge.date.slice(0, 7);
      const row = byMonth.get(key) ?? { count: 0, amount: 0 };
      row.count += 1;
      row.amount += charge.amount;
      byMonth.set(key, row);
    }
    const thisMonth = monthKey(new Date());
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    // 우리가 이번 달에 실제로 올린 건수. eBay 청구 건수와 함께 봐야 한도가 보인다.
    const publishedThisMonth = await prisma.listingDraft.count({
      where: { ebayItemId: { not: null }, updatedAt: { gte: monthStart } },
    });
    const paidThisMonth = byMonth.get(thisMonth) ?? { count: 0, amount: 0 };

    return Response.json({
      ok: true,
      days,
      measured: {
        orders: orders.length,
        itemSubtotal: Number(itemSubtotal.toFixed(2)),
        shipping: Number(shipping.toFixed(2)),
        buyerPaid: Number(buyerPaid.toFixed(2)),
        feeBasis: Number(feeBasis.toFixed(2)),
        // 수수료 기준이 구매자 결제액보다 큰 만큼이 eBay가 걷은 판매세다.
        salesTaxUpliftRate:
          buyerPaid > 0 ? Number((feeBasis / buyerPaid - 1).toFixed(4)) : null,
        finalValueRate: feeBasis > 0 ? Number((finalValue / feeBasis).toFixed(4)) : null,
        internationalRate: feeBasis > 0 ? Number((international / feeBasis).toFixed(4)) : null,
        perOrderFeeUsd:
          orders.length > 0 ? Number((perOrder / orders.length).toFixed(2)) : null,
        advertisingChargedRate: feeBasis > 0 ? Number((advertising / feeBasis).toFixed(4)) : null,
        averageShippingUsd:
          orders.length > 0 ? Number((shipping / orders.length).toFixed(2)) : null,
        fees: { finalValue, international, perOrder, advertising, insertion },
        totalFee: Number(
          (finalValue + international + perOrder + advertising + insertion).toFixed(2),
        ),
      },
      listing: {
        allowance,
        publishedThisMonth,
        paidThisMonth: paidThisMonth.count,
        paidAmountThisMonth: Number(paidThisMonth.amount.toFixed(2)),
        freeUsedThisMonth: Math.max(0, publishedThisMonth - paidThisMonth.count),
        insertionFeePerListing:
          paidThisMonth.count > 0
            ? Number((paidThisMonth.amount / paidThisMonth.count).toFixed(2))
            : null,
        months: [...byMonth.entries()]
          .map(([month, value]) => ({
            month,
            count: value.count,
            amount: Number(value.amount.toFixed(2)),
          }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
