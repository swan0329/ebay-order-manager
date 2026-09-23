import "server-only";
import { randomInt } from "node:crypto";
import { getRegistrationCandidates } from "@/lib/channel-registration-candidates";
import { prisma } from "@/lib/prisma";
import { getVariationListingGroups } from "@/lib/variation-listing-products";
import { buildEbayListingTitle, buildEbayVariationListingTitle } from "@/lib/ebay-listing-fields";
import type { ProductSalesChannel } from "@/lib/product-operations";

export async function getRegistrationPreview(channel: ProductSalesChannel, random = false, excludeIds: string[] = []) {
  const candidates = await getRegistrationCandidates(channel, Number.MAX_SAFE_INTEGER);
  const excluded = new Set(excludeIds);
  const pool = candidates.products.filter((product) => !excluded.has(product.id));
  if (!pool.length) return { target: null, eligibleCount: candidates.eligibleCount, noAlternative: candidates.eligibleCount > 0 };
  const selected = pool[random ? randomInt(pool.length) : 0];
  const [product, groups] = await Promise.all([
    prisma.product.findUnique({ where: { id: selected.id } }),
    getVariationListingGroups(),
  ]);
  if (!product) throw new Error("시험등록 대상을 찾을 수 없습니다.");
  const group = groups.find((entry) => entry.products.some((member) => member.id === product.id));
  const members = group?.products ?? [product];
  return {
    eligibleCount: candidates.eligibleCount,
    noAlternative: false,
    target: {
      productId: product.id,
      sku: product.sku,
      title: group ? buildEbayVariationListingTitle(group) : buildEbayListingTitle(product),
      grouped: Boolean(group),
      memberIds: members.map((member) => member.id),
      members: members.map((member) => ({
        id: member.id, sku: member.sku,
        label: "variationName" in member ? String(member.variationName) : member.optionName || member.sku,
        imageUrl: member.imageUrl || member.ebayImageUrls?.[0] || null,
        ebayRegistered: Boolean(member.ebayItemId), shopifyRegistered: Boolean(member.shopifyProductId),
      })),
    },
  };
}
