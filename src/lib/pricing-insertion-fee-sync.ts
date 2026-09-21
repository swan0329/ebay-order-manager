import "server-only";
import { prisma } from "@/lib/prisma";
import {
  recommendedInsertionFeeUsd,
  summarizeInsertionFees,
} from "@/lib/ebay-insertion-fees";
import { getFinanceFeeBreakdown } from "@/lib/services/ebayFinanceService";

/** 지난 달 청구까지 보고 단가를 알아내되, 판매가에 얹을지는 이번 달 청구로 정한다. */
const LOOKBACK_DAYS = 90;

/**
 * 가격 계산에 쓰는 등록수수료를 eBay 정산에서 확인된 값으로 맞춘다.
 *
 * 사람이 손으로 넣던 값이다. 무료 할당량을 넘긴 달에는 등록할 때마다 돈이 나가고 안
 * 넘긴 달에는 0인데, 그걸 사람이 매달 확인해 고쳐 넣을 수는 없다. 정산에 찍힌 청구만
 * 보고 정한다. 정산을 읽지 못하면 값을 건드리지 않는다. 모르는 상태에서 0으로 밀면
 * 판매가가 조용히 낮아진다.
 */
export async function syncInsertionFeeSetting(userId: string) {
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  if (!settings) return { ok: false as const, reason: "가격 설정이 아직 없습니다." };

  const finance = await getFinanceFeeBreakdown(userId, LOOKBACK_DAYS, true);
  const summary = summarizeInsertionFees(finance.charges ?? []);
  const recommended = recommendedInsertionFeeUsd(summary);

  const current = Number(settings.insertionFeeUsd);
  // 1센트 미만 차이는 반올림 잡음이다. 저장 이력을 늘리지 않는다.
  if (Number.isFinite(current) && Math.abs(current - recommended.usd) < 0.005) {
    return { ok: true as const, changed: false, ...recommended };
  }

  await prisma.pricingSettings.update({
    where: { id: "default" },
    data: { insertionFeeUsd: recommended.usd.toFixed(2) },
  });
  await prisma.syncLog.create({
    data: {
      userId,
      type: "PRICING_INSERTION_FEE",
      status: "SUCCESS",
      message: `등록수수료 설정 ${current.toFixed(2)} → ${recommended.usd.toFixed(2)} (이번 달 청구 ${summary.chargedCount}건 ${summary.amount.toFixed(2)})`,
      rawJson: {
        previousUsd: current,
        nextUsd: recommended.usd,
        month: summary.month,
        chargedCount: summary.chargedCount,
        chargedAmount: summary.amount,
        allowanceExhausted: recommended.allowanceExhausted,
      },
    },
  });
  return { ok: true as const, changed: true, previousUsd: current, ...recommended };
}
