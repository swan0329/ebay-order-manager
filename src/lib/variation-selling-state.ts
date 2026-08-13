import "server-only";

import { prisma } from "@/lib/prisma";
import { collectActiveVariationProductIds } from "@/lib/variation-selling-state-core";

export async function getActiveVariationSellingState(userId: string) {
  const states = await prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { not: null } },
    select: { ebayItemId: true, includedProductIds: true },
  });
  return {
    listingCount: states.length,
    productIds: collectActiveVariationProductIds(states),
  };
}

export async function getActiveVariationProductListings(userId: string) {
  const states = await prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { not: null } },
    select: { ebayItemId: true, title: true, includedProductIds: true },
  });
  const result = new Map<string, { itemId: string; title: string }>();
  for (const state of states) {
    if (!state.ebayItemId || !Array.isArray(state.includedProductIds)) continue;
    for (const id of state.includedProductIds) {
      if (typeof id === "string") result.set(id, { itemId: state.ebayItemId, title: state.title });
    }
  }
  return result;
}
