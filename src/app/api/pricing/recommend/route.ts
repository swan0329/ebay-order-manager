import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { calculateRecommendedPrice } from "@/lib/pricing";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 원화 원가를 넣으면 저장된 가격 설정으로 권장 판매가(USD)를 계산해 보여준다.
// 계산만 하고 아무것도 저장하지 않는다. 실제 반영은 사람이 값을 확인하고
// eBay 판매가를 저장할 때만 일어난다(docs/business-rules.md 가격 계산).
const schema = z.object({
  priceKrw: z.union([z.number(), z.string()]),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse(await request.json());
    const priceKrw = Number(input.priceKrw);
    if (!Number.isFinite(priceKrw) || priceKrw < 0) {
      return jsonError("0 이상의 원화 금액을 입력해 주세요.", 422);
    }

    const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
    if (!settings) {
      return jsonError("가격 설정을 먼저 저장해 주세요.", 422);
    }

    const result = calculateRecommendedPrice({
      pocaPriceKrw: priceKrw,
      domesticShippingKrw: settings.domesticShippingKrw,
      buyingAgencyFeeKrw: settings.buyingAgencyFeeKrw,
      exchangeRateKrwPerUsd: settings.exchangeRateKrwPerUsd,
      targetMarginRate: settings.targetMarginRate,
      ebayFeeRate: settings.ebayFeeRate,
      advertisingRate: settings.advertisingRate,
      roundingIncrementUsd: settings.roundingIncrementUsd,
    });

    return Response.json({
      recommendedPriceUsd: result.recommendedPriceUsd.toFixed(2),
      totalCostKrw: result.totalCostKrw.toFixed(0),
      costUsd: result.costUsd.toFixed(2),
      expectedNetMarginUsd: result.expectedNetMarginUsd.toFixed(2),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("계산할 금액을 확인해 주세요.", 422, error.flatten());
    }

    // calculateRecommendedPrice의 설정 검증 실패(환율 0, 수수료 합 100% 등)
    return jsonError(asErrorMessage(error), 422);
  }
}
