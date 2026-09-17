import "server-only";

import { prisma } from "@/lib/prisma";
import { hasListingPrice } from "@/lib/listing-price";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";

export type VariationReadyImage = {
  id: string;
  listingImageUrl: string;
  listingImageIsImageWork: boolean;
};

export async function getEbayVariationMembershipByProductId(userId: string) {
  const states = await prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { not: null } },
    select: { ebayItemId: true, includedProductIds: true },
  });
  const membership = new Map<string, string>();
  for (const state of states) {
    if (!state.ebayItemId || !Array.isArray(state.includedProductIds)) continue;
    for (const productId of state.includedProductIds) {
      if (typeof productId === "string") membership.set(productId, state.ebayItemId);
    }
  }
  // Imported/manual variation listings can predate variationListingState.
  // Identify them from the account's report, but only for an existing exact
  // Item ID + SKU connection. A matching SKU alone must never relink a card.
  const latest = await prisma.ebayReportImport.findFirst({
    where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true },
  });
  if (!latest) return membership;
  const rows = await prisma.ebayActiveListing.findMany({
    where: { importId: latest.id, status: "ACTIVE" },
    select: { itemId: true, sku: true },
  });
  const skusByItem = new Map<string, Set<string>>();
  const exactCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.sku) continue;
    const skus = skusByItem.get(row.itemId) ?? new Set<string>();
    skus.add(row.sku);
    skusByItem.set(row.itemId, skus);
    const key = `${row.itemId}\u0000${row.sku}`;
    exactCounts.set(key, (exactCounts.get(key) ?? 0) + 1);
  }
  const parentIds = [...skusByItem].filter(([, skus]) => skus.size > 1).map(([id]) => id);
  if (!parentIds.length) return membership;
  const products = await prisma.product.findMany({
    where: { ebayItemId: { in: parentIds } },
    select: { id: true, ebayItemId: true, sku: true },
  });
  for (const product of products) {
    if (!membership.has(product.id) && product.ebayItemId &&
        exactCounts.get(`${product.ebayItemId}\u0000${product.sku}`) === 1) {
      membership.set(product.id, product.ebayItemId);
    }
  }
  return membership;
}

/** Only cards whose final listing image has actually been completed/approved. */
export async function getVariationListingReadyImages() {
  const rows = await prisma.$queryRaw<VariationReadyImage[]>`
    SELECT p."id"
      , COALESCE(approved."imageUrl", p."user_front_image_url") AS "listingImageUrl"
      , (approved."imageUrl" IS NOT NULL) AS "listingImageIsImageWork"
    FROM "products" p
    LEFT JOIN LATERAL (
      SELECT h."image_url" AS "imageUrl"
      FROM "product_image_history" h
      WHERE h."product_id" = p."id"
        AND h."action" IN ('lens_saved', 'worker_approved', 'ai_approved')
        AND h."image_url" IS NOT NULL
        AND h."image_url" NOT LIKE '%/products/channel-watermarked/%'
        AND h."image_url" NOT LIKE '%/products/ebay-watermarked/%'
      ORDER BY h."created_at" DESC
      LIMIT 1
    ) approved ON true
    WHERE (
      p."stock_quantity" > 0
      OR COALESCE(p."pocamarket_available_count", 0) > 0
    )
    AND (
      COALESCE(approved."imageUrl", p."user_front_image_url", '') <> ''
    )
    AND COALESCE(
      approved."imageUrl",
      p."user_front_image_url",
      ''
    ) <> ''
  `;
  return rows;
}

/** Products that must go through a variation listing instead of a new single listing. */
export async function getVariationCandidateProductIds() {
  const readyImages = await getVariationListingReadyImages();
  if (!readyImages.length) return new Set<string>();
  const products = await prisma.product.findMany({
    where: { id: { in: readyImages.map((row) => row.id) } },
  });
  const readyImageById = new Map(readyImages.map((row) => [row.id, row]));
  const eligible = products
    .filter(hasListingPrice)
    .map((product) => ({
      ...product,
      imageUrl: readyImageById.get(product.id)?.listingImageUrl ?? null,
      listingImageIsImageWork: readyImageById.get(product.id)?.listingImageIsImageWork ?? false,
      ebayImageUrls: [],
    }));
  return new Set(
    buildVariationListingGroups(eligible).groups
      .filter((group) => group.products.length <= 40)
      .flatMap((group) => group.products.map((product) => product.id)),
  );
}

/** Complete, currently sellable groups used by every channel publisher. */
export async function getVariationListingGroups() {
  const readyImages = await getVariationListingReadyImages();
  if (!readyImages.length) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: readyImages.map((row) => row.id) } },
  });
  const imageById = new Map(readyImages.map((row) => [row.id, row]));
  const eligible = products.filter(hasListingPrice).map((product) => ({
    ...product,
    imageUrl: imageById.get(product.id)?.listingImageUrl ?? null,
    listingImageIsImageWork: imageById.get(product.id)?.listingImageIsImageWork ?? false,
    ebayImageUrls: [],
  }));
  return buildVariationListingGroups(eligible).groups.filter(
    (group) => group.products.length <= 40,
  );
}
