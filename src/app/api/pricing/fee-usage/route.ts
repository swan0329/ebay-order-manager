import { getOrdersFromEbay } from "@/lib/ebay";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getActiveEbayAccount } from "@/lib/services/ebayApiService";
import { getFinanceFeeBreakdown } from "@/lib/services/ebayFinanceService";
import { chargedListingIds, summarizeInsertionFees } from "@/lib/ebay-insertion-fees";

export const maxDuration = 60;

function money(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const parsed = Number((value as { value?: unknown }).value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * eBay가 실제로 떼 간 수수료와 등록수수료 청구 내역을 한 번에 돌려준다. 가격 설정에
 * 넣어 둔 숫자가 현실과 맞는지 사람이 화면에서 바로 대조할 수 있어야 한다. 읽기만 한다.
 *
 * 등록수수료(INSERTION_FEE)는 eBay 정산 거래에서 확인된 것만 센다. 계정의 판매 한도
 * (Selling Limit)나 우리가 올린 리스팅 수로 예상 금액을 만들지 않는다. 둘 다 무료 등록
 * 한도가 아니고, Good 'Til Cancelled 리스팅이 다음 달로 자동 갱신될 때도 등록수수료가
 * 붙기 때문에 등록 건수만으로는 청구를 맞힐 수 없다.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const days = Math.min(365, Math.max(30, Number(url.searchParams.get("days") ?? 180)));

    // 정산을 못 읽으면 수수료는 "확인 불가"다. 다른 값으로 추정하지 않는다.
    let finance: Awaited<ReturnType<typeof getFinanceFeeBreakdown>> | null = null;
    let financeError = "";
    try {
      finance = await getFinanceFeeBreakdown(user.id, days, true, "INSERTION_FEE");
    } catch (error) {
      financeError = asErrorMessage(error);
    }

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
      finance?.fees.find((row) => row.feeType === type)?.amount ?? 0;
    const finalValue = feeOf("FINAL_VALUE_FEE");
    const international = feeOf("INTERNATIONAL_FEE");
    const perOrder = feeOf("FINAL_VALUE_FEE_FIXED_PER_ORDER");
    const advertising = feeOf("AD_FEE");
    const insertion = feeOf("INSERTION_FEE");

    // eBay 정산에 찍힌 등록수수료만 모은다. 집계식은 src/lib에 하나만 둔다.
    const insertionSummary = summarizeInsertionFees(finance?.charges ?? []);
    const monthStart = new Date(`${insertionSummary.month}-01T00:00:00.000Z`);

    // 우리가 이번 달에 올린 건수. 참고용이며 등록수수료 계산에는 쓰지 않는다.
    const publishedThisMonth = await prisma.listingDraft.count({
      where: { ebayItemId: { not: null }, updatedAt: { gte: monthStart } },
    });
    // 우리가 마지막으로 수집한 활성 리스팅 수. eBay의 현재 값과 다를 수 있으므로
    // 언제 수집한 것인지 함께 보내고, 이 숫자로 앞으로 나갈 돈을 추정하지 않는다.
    const latestReport = await prisma.ebayReportImport.findFirst({
      where: { completeSnapshot: true },
      orderBy: { createdAt: "desc" },
      select: { rowCount: true, createdAt: true },
    });
    // 어떤 리스팅에 붙었는지 사람이 eBay에서 직접 확인할 수 있게 번호를 남긴다.
    const chargedItemIds = chargedListingIds(finance?.raw ?? []);

    return Response.json({
      ok: true,
      days,
      finance: {
        // 출처: Sell Finances API GET /sell/finances/v1/transaction
        available: finance !== null,
        error: financeError || null,
        transactionCount: finance?.transactionCount ?? 0,
      },
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
      insertionFee: {
        // eBay 정산에서 확인된 등록수수료만 담는다. 확인 불가면 available이 false다.
        available: finance !== null,
        ...insertionSummary,
        chargedItemIds,
      },
      // 참고 숫자. 등록수수료 계산에는 쓰지 않는다.
      reference: {
        publishedThisMonth,
        activeListings: latestReport?.rowCount ?? 0,
        activeListingsAt: latestReport?.createdAt ?? null,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
