import "server-only";

import { prisma } from "@/lib/prisma";
import { planEbayInventoryPush } from "@/lib/services/ebayInventoryPush";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { reservedByProduct } from "@/lib/stock-reservation";
import { availabilityReason, resolveChannelAvailability } from "@/lib/channel-availability";
import { buildVariationListingGroups, variationParentSku } from "@/lib/variation-listing-groups";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";

const ACTIVE = ["ACTIVE", "PUBLISHED", "LISTED"];

function priceChanged(current: number | null, previous: number | null) {
  if (current === null) return false;
  if (previous === null) return true;
  return Math.abs(current - previous) >= 0.005;
}

export async function getEbayOperations(userId: string) {
  const [drafts, preparationCount, inventory] = await Promise.all([
    prisma.listingDraft.findMany({
      where: {
        userId,
        // 신규등록 화면에는 전체 필수 검증을 통과한 초안만 노출한다.
        // 단순히 이미지와 가격이 있다는 이유만으로 "등록 가능"으로 세면 안 된다.
        status: "validated",
        sourceInventory: {
          ebayItemId: null,
          OR: [{ listingStatus: null }, { listingStatus: { notIn: ACTIVE } }],
        },
      },
      select: {
        id: true, sku: true, title: true, price: true, quantity: true,
        status: true, errorSummary: true, updatedAt: true, sourceInventoryId: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.listingDraft.count({
      where: {
        userId,
        status: { in: ["draft", "failed"] },
        sourceInventory: {
          ebayItemId: null,
          OR: [{ listingStatus: null }, { listingStatus: { notIn: ACTIVE } }],
        },
      },
    }),
    planEbayInventoryPush({ userId }),
  ]);

  const newestDraftByProduct = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    if (draft.sourceInventoryId && !newestDraftByProduct.has(draft.sourceInventoryId)) {
      newestDraftByProduct.set(draft.sourceInventoryId, draft);
    }
  }
  const create = [...newestDraftByProduct.values()].map((draft) => ({
    id: draft.id,
    productId: draft.sourceInventoryId,
    sku: draft.sku,
    name: draft.title,
    price: draft.price == null ? null : Number(draft.price),
    quantity: draft.quantity,
    status: draft.status,
    error: draft.errorSummary,
  }));
  // 실제 품절/판매중지와 주문 예약 보류를 분리한다. 예약 보류는 수량 0 전송은
  // 가능하지만, 상품 자체가 품절된 것으로 집계하지 않는다.
  const unavailable = inventory.rows.filter((row) =>
    ["SOLD_OUT", "DISCONTINUED"].includes(row.availabilityStatus),
  );
  const review = inventory.rows.filter((row) =>
    ["HELD_FOR_ORDER", "SOURCE_UNKNOWN"].includes(row.availabilityStatus),
  );
  const unavailableIds = new Set(unavailable.map((row) => row.productId));
  const change = inventory.rows.filter((row) =>
    !unavailableIds.has(row.productId) &&
    (row.listingType === "SINGLE" || row.previousQuantity !== null || row.previousPrice !== null) &&
    (row.previousQuantity !== row.quantity || priceChanged(row.price, row.previousPrice)),
  );

  return {
    create,
    change,
    unavailable: unavailable.map((row) => ({ ...row, reason: availabilityReason(row.availabilityStatus, row.listingType === "VARIATION_OPTION") })),
    review: review.map((row) => ({ ...row, reason: availabilityReason(row.availabilityStatus, row.listingType === "VARIATION_OPTION") })),
    summary: {
      createReady: create.length,
      createNeedsReview: preparationCount,
      createCountMeaning: "eBay 필수 검증을 모두 통과한 등록 초안 수",
      unavailableOptions: unavailable.filter((row) => row.listingType === "VARIATION_OPTION").length,
      unavailableSingles: unavailable.filter((row) => row.listingType === "SINGLE").length,
      sourceReview: review.filter((row) => row.availabilityStatus === "SOURCE_UNKNOWN").length,
      heldForOrder: review.filter((row) => row.availabilityStatus === "HELD_FOR_ORDER").length,
    },
    limits: { createBatch: 50, reviseBatch: 200 },
  };
}

export async function getShopifyOperations() {
  const readyImages = await getVariationListingReadyImages();
  const readyImageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
  const [products, settings] = await Promise.all([
    prisma.product.findMany({
      where: { OR: [
        { shopifyProductId: { not: null } },
        { productListings: { some: { channel: "SHOPIFY" } } },
        { AND: [
          { shopifyProductId: null }, { id: { in: [...readyImageById.keys()] } },
          { OR: [{ salePrice: { not: null } }, { ebayPrice: { not: null } }] },
          { OR: [{ stockQuantity: { gt: 0 } }, { pocamarketAvailableCount: { gt: 0 }, isSoldOut: false }] },
        ] },
      ] },
      include: { productListings: { where: { channel: "SHOPIFY" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
  ]);
  const lines = await prisma.orderItem.findMany({ where: { productId: { in: products.map((product) => product.id) }, stockDeducted: false }, select: { productId: true, quantity: true, stockDeducted: true, order: { select: { orderStatus: true, fulfillmentStatus: true } } } });
  const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  const reserved = reservedByProduct(lines.map((line) => ({ productId: line.productId as string, quantity: line.quantity, stockDeducted: line.stockDeducted, orderCancelled: cancelled.includes(line.order.orderStatus) || cancelled.includes(line.order.fulfillmentStatus) })));
  const mapped = products.map((product) => {
    const listing = product.productListings[0];
    const availability = resolveChannelAvailability({ status: product.status, stockQuantity: product.stockQuantity, reservedQuantity: reserved.get(product.id) ?? 0, isSoldOut: product.isSoldOut, pocamarketAvailableCount: product.pocamarketAvailableCount, pocamarketSyncedAt: product.pocamarketSyncedAt });
    const price = settings ? Number(resolveListingPriceUsd(product, settings)?.priceUsd ?? 0) || null : null;
    return { productId: product.id, sku: product.sku, productName: product.productName, itemId: listing?.externalId ?? product.shopifyProductId ?? "-", price, previousQuantity: listing?.quantity ?? null, previousPrice: listing?.price == null ? null : Number(listing.price), productStatus: product.status, linked: Boolean(listing?.externalId ?? product.shopifyProductId), product: readyImageById.has(product.id) ? { ...product, imageUrl: readyImageById.get(product.id)! } : product, ...availability };
  });
  const unlinked = mapped.filter((row) => !row.linked && row.availabilityStatus === "AVAILABLE" && row.price !== null);
  const byId = new Map(unlinked.map((row) => [row.productId, row]));
  const grouped = buildVariationListingGroups(unlinked.map((row) => row.product));
  const createGroups = grouped.groups.map((group) => {
    const members = group.products.map((product) => byId.get(product.id)!);
    const prices = members.map((member) => member.price as number);
    const targetId = `group:${variationParentSku(group.key)}`;
    return { id: targetId, productId: targetId, productIds: members.map((member) => member.productId), groupKey: group.key, sku: variationParentSku(group.key), name: group.title, price: Math.min(...prices), priceMax: Math.max(...prices), quantity: members.reduce((sum, member) => sum + member.quantity, 0), optionCount: members.length, options: group.products.map((product) => { const member = byId.get(product.id)!; return { sku: member.sku, name: product.variationName, quantity: member.quantity, price: member.price }; }), listingType: "VARIATION" as const, status: `묶음상품 ${members.length}옵션`, error: null };
  });
  const createSingles = grouped.unmatched.map((product) => {
    const row = byId.get(product.id)!;
    return { id: `product:${row.productId}`, productId: row.productId, productIds: [row.productId], sku: row.sku, name: row.productName, price: row.price, priceMax: row.price, quantity: row.quantity, optionCount: 1, listingType: "SINGLE" as const, status: "단품 준비완료", error: null };
  });
  const create = [...createGroups, ...createSingles];
  const linked = mapped.filter((row) => row.linked);
  const linkedBuckets = new Map<string, typeof linked>();
  for (const row of linked) linkedBuckets.set(row.itemId, [...(linkedBuckets.get(row.itemId) ?? []), row]);
  const change: Array<Record<string, unknown>> = [];
  const unavailable: Array<Record<string, unknown>> = [];
  for (const [externalId, members] of linkedBuckets) {
    if (members.length === 1) {
      const row = members[0];
      if (row.availabilityStatus !== "AVAILABLE") unavailable.push({ ...row, reason: availabilityReason(row.availabilityStatus), listingType: "SINGLE", productIds: [row.productId] });
      else if (row.previousQuantity !== row.quantity || priceChanged(row.price, row.previousPrice)) change.push({ ...row, listingType: "SINGLE", productIds: [row.productId] });
      continue;
    }
    const unavailableMembers = members.filter((row) => row.availabilityStatus !== "AVAILABLE");
    const changedMembers = members.filter((row) => row.previousQuantity !== row.quantity || priceChanged(row.price, row.previousPrice));
    const groupedRow = {
      productId: `shopify-listing:${externalId}`,
      productIds: members.map((row) => row.productId),
      sku: `묶음 ${members.length}옵션`,
      productName: members[0].product.productName,
      itemId: externalId,
      quantity: members.reduce((sum, row) => sum + row.quantity, 0),
      price: Math.min(...members.flatMap((row) => row.price == null ? [] : [row.price])),
      previousQuantity: members.reduce((sum, row) => sum + (row.previousQuantity ?? 0), 0),
      previousPrice: null,
      listingType: "VARIATION",
      optionCount: members.length,
      affectedOptions: (unavailableMembers.length ? unavailableMembers : changedMembers).map((row) => ({ sku: row.sku, name: row.productName, previousQuantity: row.previousQuantity, quantity: row.quantity, previousPrice: row.previousPrice, price: row.price })),
    };
    if (unavailableMembers.length) unavailable.push({ ...groupedRow, actionable: unavailableMembers.every((row) => row.actionable), reason: unavailableMembers.map((row) => availabilityReason(row.availabilityStatus, true)).join(" / ") });
    else if (changedMembers.length) change.push(groupedRow);
  }
  const actualUnavailable = unavailable.filter((row) => ["SOLD_OUT", "DISCONTINUED"].includes(String(row.availabilityStatus)));
  const review = unavailable.filter((row) => ["HELD_FOR_ORDER", "SOURCE_UNKNOWN"].includes(String(row.availabilityStatus)));
  return { create, change, unavailable: actualUnavailable, review, summary: { shopifyListings: create.length, shopifyVariationListings: createGroups.length, shopifySingleListings: createSingles.length, shopifyOptions: unlinked.length, unavailableOptions: actualUnavailable.filter((row) => row.listingType === "VARIATION").length, unavailableSingles: actualUnavailable.filter((row) => row.listingType === "SINGLE").length, sourceReview: review.filter((row) => row.availabilityStatus === "SOURCE_UNKNOWN").length, heldForOrder: review.filter((row) => row.availabilityStatus === "HELD_FOR_ORDER").length }, limits: { createBatch: 50, reviseBatch: 100 } };
}
