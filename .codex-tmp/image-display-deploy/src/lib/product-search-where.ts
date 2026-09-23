import { prisma } from "@/lib/prisma";
import { productWhere } from "@/lib/products";
import { parseProductSearchTerms } from "@/lib/product-search";

export async function productSearchWhere(params: Parameters<typeof productWhere>[0], userId: string) {
  const filters = { ...params, relatedProductIds: undefined, relatedEbayItemIds: undefined };
  const identifiers = parseProductSearchTerms(params.q).filter(term => /^VAR-[A-Z0-9]+$/i.test(term) || /^\d{9,15}$/.test(term));
  if (!identifiers.length) return productWhere(filters);
  // Search saved membership, not just today's sellable/approved-image candidates.
  const states = await prisma.variationListingState.findMany({
    where: { userId, OR: identifiers.map(term => /^VAR-/i.test(term)
      ? { parentSku: { contains: term, mode: "insensitive" as const } }
      : { ebayItemId: term }) },
    select: { includedProductIds: true, pendingProductIds: true, ebayItemId: true },
  });
  const ids = states.flatMap(state => [state.includedProductIds, state.pendingProductIds].flatMap(value => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []));
  return productWhere({ ...filters,
    relatedProductIds: [...new Set(ids)],
    relatedEbayItemIds: [...new Set(states.map(state => state.ebayItemId).filter((id): id is string => Boolean(id)))],
  });
}
