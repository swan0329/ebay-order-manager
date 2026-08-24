import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { validatePricingSettings } from "@/lib/pricing";

function serialize(settings: NonNullable<Awaited<ReturnType<typeof prisma.pricingSettings.findUnique>>>) {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => key !== "minimumSalePriceUsd").map(([key, value]) => [
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
    const input = {
      domesticShippingKrw: String(body.domesticShippingKrw ?? ""),
      buyingAgencyFeeKrw: String(body.buyingAgencyFeeKrw ?? ""),
      exchangeRateKrwPerUsd: String(body.exchangeRateKrwPerUsd ?? ""),
      targetMarginRate: String(body.targetMarginRate ?? ""),
      ebayFeeRate: String(body.ebayFeeRate ?? ""),
      advertisingRate: String(body.advertisingRate ?? ""),
      roundingIncrementUsd: "0.10",
    };
    validatePricingSettings(input);
    const settings = await prisma.pricingSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...input, minimumSalePriceUsd: null, allocationMethod: "PER_CARD_FIXED", updatedById: user.id },
      update: { ...input, minimumSalePriceUsd: null, allocationMethod: "PER_CARD_FIXED", updatedById: user.id },
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
