import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { validatePricingSettings } from "@/lib/pricing";

function serialize(settings: NonNullable<Awaited<ReturnType<typeof prisma.pricingSettings.findUnique>>>) {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      value && typeof value === "object" && "toFixed" in value
        ? String(value)
        : value,
    ]),
  );
}

export async function GET() {
  try {
    await requireApiUser();
    const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
    return NextResponse.json({ settings: settings ? serialize(settings) : null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof UnauthorizedError ? "관리자 권한이 필요합니다." : "가격 설정을 불러오지 못했습니다." },
      { status: error instanceof UnauthorizedError ? 401 : 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    // 등록수수료는 eBay 정산을 보고 자동으로 맞춘다. 화면이 보내지 않으면 지금 값을
    // 지킨다. 없는 값을 0으로 밀면 판매가가 조용히 낮아진다.
    const existing = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
    const input = {
      domesticShippingKrw: String(body.domesticShippingKrw ?? ""),
      buyingAgencyFeeKrw: String(body.buyingAgencyFeeKrw ?? ""),
      exchangeRateKrwPerUsd: String(body.exchangeRateKrwPerUsd ?? ""),
      targetMarginRate: String(body.targetMarginRate ?? ""),
      ebayFeeRate: String(body.ebayFeeRate ?? ""),
      advertisingRate: String(body.advertisingRate ?? ""),
      internationalFeeRate: String(body.internationalFeeRate ?? "0"),
      perOrderFeeUsd: String(body.perOrderFeeUsd ?? "0"),
      buyerShippingUsd: String(body.buyerShippingUsd ?? "0"),
      salesTaxUpliftRate: String(body.salesTaxUpliftRate ?? "0"),
      insertionFeeUsd: String(body.insertionFeeUsd ?? existing?.insertionFeeUsd ?? "0"),
      minimumSalePriceUsd:
        body.minimumSalePriceUsd === "" || body.minimumSalePriceUsd == null
          ? null
          : String(body.minimumSalePriceUsd),
      roundingIncrementUsd: "0.10",
    };
    validatePricingSettings(input);
    const settings = await prisma.pricingSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...input, allocationMethod: "PER_CARD_FIXED", updatedById: user.id },
      update: { ...input, allocationMethod: "PER_CARD_FIXED", updatedById: user.id },
    });
    return NextResponse.json({ settings: serialize(settings) });
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return NextResponse.json(
      { error: unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "가격 설정을 저장하지 못했습니다." },
      { status: unauthorized ? 401 : 400 },
    );
  }
}
