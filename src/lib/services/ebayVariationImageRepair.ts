import "server-only";

import { prisma } from "@/lib/prisma";
import { getEbayConfig } from "@/lib/env";
import { buildVariationListingGroups, type VariationListingGroup } from "@/lib/variation-listing-groups";
import { getVariationListingImagesByIds } from "@/lib/variation-listing-products";
import { ensureVariationThumbnail } from "@/lib/services/shopifyVariationMedia";
import { reviseEbayRepresentativePicture } from "@/lib/services/ebayRevise";

export type EbayVariationImageRepairRow = {
  productId: string;
  productIds: string[];
  groupKey: string;
  sku: string;
  productName: string;
  itemId: string;
  quantity: number;
  price: null;
  previousQuantity: null;
  previousPrice: null;
  listingType: "VARIATION";
  optionCount: number;
  imageCount: number;
  actionable: boolean;
  reason: string;
};

async function activeVariationStates(userId: string) {
  const latest = await prisma.ebayReportImport.findFirst({
    where: { userId, completeSnapshot: true },
    orderBy: { createdAt: "desc" },
    select: { listings: { where: { status: "ACTIVE" }, select: { itemId: true } } },
  });
  if (!latest) return [];
  const activeItemIds = latest.listings.map((row) => row.itemId);
  if (!activeItemIds.length) return [];
  return prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { in: activeItemIds } },
    select: { groupKey: true, parentSku: true, title: true, ebayItemId: true, includedProductIds: true },
  });
}

async function groupsForStates(userId: string) {
  const states = await activeVariationStates(userId);
  const ids = [...new Set(states.flatMap((state) => Array.isArray(state.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : []))];
  const images = await getVariationListingImagesByIds(ids);
  const imageById = new Map(images.map((row) => [row.id, row.listingImageUrl]));
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, brand: true, category: true, productName: true, optionName: true } });
  const productById = new Map(products.map((product) => [product.id, product]));
  return states.map((state) => {
    const productIds = Array.isArray(state.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : [];
    const members = productIds.flatMap((id) => {
      const product = productById.get(id); const imageUrl = imageById.get(id);
      return product && imageUrl ? [{ ...product, imageUrl }] : [];
    });
    const rebuilt = buildVariationListingGroups(members).groups.find((group) => group.key === state.groupKey);
    return { state, productIds, group: rebuilt ?? null, imageCount: members.length };
  });
}

export async function listEbayVariationImageRepairs(userId: string): Promise<EbayVariationImageRepairRow[]> {
  const rows = await groupsForStates(userId);
  return rows.flatMap(({ state, productIds, group, imageCount }) => state.ebayItemId ? [{
    productId: `ebay-image:${state.ebayItemId}`,
    productIds,
    groupKey: state.groupKey,
    sku: state.parentSku,
    productName: state.title,
    itemId: state.ebayItemId,
    quantity: 0,
    price: null,
    previousQuantity: null,
    previousPrice: null,
    listingType: "VARIATION" as const,
    optionCount: productIds.length,
    imageCount,
    actionable: Boolean(group && imageCount === productIds.length && productIds.length >= 2),
    reason: group && imageCount === productIds.length ? "현재 워터마크 설정으로 eBay 묶음 대표사진 교체 가능" : `최종 승인 이미지 ${imageCount}/${productIds.length}장 · 누락 이미지를 준비해야 교체 가능`,
  }] : []);
}

export async function repairEbayVariationImage(userId: string, targetId: string) {
  const rows = await groupsForStates(userId);
  const target = rows.find(({ state }) => state.ebayItemId && `ebay-image:${state.ebayItemId}` === targetId);
  if (!target?.state.ebayItemId || !target.group || target.imageCount !== target.productIds.length) throw new Error("eBay 묶음 대표사진 교체 대상을 다시 확인해 주세요.");
  const thumbnailUrl = await ensureVariationThumbnail(userId, target.group as VariationListingGroup);
  const config = getEbayConfig();
  const account = await prisma.ebayAccount.findFirst({ where: { userId, environment: config.environment === "production" ? "PRODUCTION" : "SANDBOX" }, orderBy: { updatedAt: "desc" } });
  if (!account) throw new Error("eBay 계정이 연결되어 있지 않습니다.");
  return reviseEbayRepresentativePicture(account, target.state.ebayItemId, thumbnailUrl);
}
