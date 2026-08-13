import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateRecommendedPrice } from "@/lib/pricing";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

function itemJson(item: {
  id: string; productId: string; pocaPriceKrw: unknown; totalCostKrw: unknown;
  costUsd: unknown; rawRecommendedPriceUsd: unknown; recommendedPriceUsd: unknown;
  expectedProceedsUsd: unknown; expectedNetMarginUsd: unknown; expectedNetMarginRate: unknown;
  appliedDraftId: string | null; product: { sku: string; productName: string };
}) {
  return {
    ...item,
    pocaPriceKrw: String(item.pocaPriceKrw), totalCostKrw: String(item.totalCostKrw),
    costUsd: String(item.costUsd), rawRecommendedPriceUsd: String(item.rawRecommendedPriceUsd),
    recommendedPriceUsd: String(item.recommendedPriceUsd),
    expectedProceedsUsd: String(item.expectedProceedsUsd),
    expectedNetMarginUsd: String(item.expectedNetMarginUsd),
    expectedNetMarginRate: String(item.expectedNetMarginRate),
  };
}

export async function GET() {
  try {
    await requireApiUser();
    const reviews = await prisma.pricingReview.findMany({
      orderBy: { createdAt: "desc" }, take: 20,
      include: { items: { include: { product: { select: { sku: true, productName: true } } } } },
    });
    return NextResponse.json({ reviews: reviews.map((review) => ({
      id: review.id, status: review.status, createdAt: review.createdAt,
      approvedAt: review.approvedAt,
      items: review.items.map(itemJson),
    })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof UnauthorizedError ? "관리자 권한이 필요합니다." : "검토 목록을 불러오지 못했습니다." }, { status: error instanceof UnauthorizedError ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    const productIds: string[] = Array.isArray(body.productIds)
      ? Array.from(new Set<string>(body.productIds.filter((id: unknown): id is string => typeof id === "string")))
      : [];
    if (!productIds.length) throw new Error("계산할 상품을 선택해 주세요.");
    const [settings, products] = await Promise.all([
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
      prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, salePrice: true } }),
    ]);
    if (!settings) throw new Error("가격 설정을 먼저 저장해 주세요.");
    if (products.length !== productIds.length) throw new Error("일부 상품을 찾을 수 없습니다.");
    const calculated = products.map((product) => {
      if (product.salePrice == null) throw new Error("포카마켓 가격이 없는 상품이 포함되어 있습니다.");
      return { productId: product.id, ...calculateRecommendedPrice({
        pocaPriceKrw: product.salePrice,
        domesticShippingKrw: settings.domesticShippingKrw,
        buyingAgencyFeeKrw: settings.buyingAgencyFeeKrw,
        exchangeRateKrwPerUsd: settings.exchangeRateKrwPerUsd,
        targetMarginRate: settings.targetMarginRate,
        ebayFeeRate: settings.ebayFeeRate,
        advertisingRate: settings.advertisingRate,
        minimumSalePriceUsd: settings.minimumSalePriceUsd,
        roundingIncrementUsd: settings.roundingIncrementUsd,
      }) };
    });
    const review = await prisma.pricingReview.create({
      data: {
        domesticShippingKrw: settings.domesticShippingKrw,
        buyingAgencyFeeKrw: settings.buyingAgencyFeeKrw,
        exchangeRateKrwPerUsd: settings.exchangeRateKrwPerUsd,
        targetMarginRate: settings.targetMarginRate, ebayFeeRate: settings.ebayFeeRate,
        advertisingRate: settings.advertisingRate,
        minimumSalePriceUsd: settings.minimumSalePriceUsd,
        roundingIncrementUsd: settings.roundingIncrementUsd,
        allocationMethod: settings.allocationMethod, createdById: user.id,
        items: { create: calculated.map(({ productId, ...result }) => ({ productId, ...result })) },
      },
      include: { items: { include: { product: { select: { sku: true, productName: true } } } } },
    });
    return NextResponse.json({ review: { id: review.id, status: review.status, items: review.items.map(itemJson) } }, { status: 201 });
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return NextResponse.json({ error: unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "권장가를 계산하지 못했습니다." }, { status: unauthorized ? 401 : 400 });
  }
}
