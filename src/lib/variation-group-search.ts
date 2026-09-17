import { normalizeProductSearchTerm } from "@/lib/product-search";
import { variationParentSku } from "@/lib/variation-listing-groups";

export function matchesVariationGroupSearch(group: {
  key: string; title: string; parentSku?: string | null; ebayItemId?: string | null;
  products: Array<{ sku: string; variationName: string; activeItemId?: string | null }>;
}, query: string) {
  const term = normalizeProductSearchTerm(query).toLowerCase();
  if (!term) return true;
  return [group.title, group.parentSku ?? variationParentSku(group.key), group.ebayItemId,
    ...group.products.flatMap(product => [product.sku, product.variationName, product.activeItemId]),
  ].filter(Boolean).join(" ").toLowerCase().includes(term);
}
