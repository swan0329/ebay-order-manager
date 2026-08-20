import "server-only";

import { prisma } from "@/lib/prisma";
import { collectActiveVariationProductIds } from "@/lib/variation-selling-state-core";

async function latestActiveVariationStates(userId: string) {
  const latest = await prisma.ebayReportImport.findFirst({
    where: { userId, completeSnapshot: true },
    orderBy: { createdAt: "desc" },
    select: { listings: { where: { status: "ACTIVE" }, select: { itemId: true } } },
  });
  // 저장된 Item ID만으로는 현재 활성 여부를 알 수 없다. 전체 활성상품 보고서가
  // 없거나 그 보고서에 없는 부모는 절대 자동 변동 대상으로 취급하지 않는다.
  if (!latest) return [];
  const activeItemIds = latest.listings.map((listing) => listing.itemId);
  if (!activeItemIds.length) return [];
  return prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { in: activeItemIds } },
    select: { ebayItemId: true, title: true, includedProductIds: true },
  });
}

export async function getActiveVariationSellingState(userId: string) {
  const states = await latestActiveVariationStates(userId);
  return {
    listingCount: states.length,
    productIds: collectActiveVariationProductIds(states),
  };
}

export async function getActiveVariationProductListings(userId: string) {
  const states = await latestActiveVariationStates(userId);
  const result = new Map<string, { itemId: string; title: string }>();
  for (const state of states) {
    if (!state.ebayItemId || !Array.isArray(state.includedProductIds)) continue;
    for (const id of state.includedProductIds) {
      if (typeof id === "string") result.set(id, { itemId: state.ebayItemId, title: state.title });
    }
  }
  return result;
}
