import "server-only";

import { prisma } from "@/lib/prisma";
import { planEbayInventoryPush } from "@/lib/services/ebayInventoryPush";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { reservedByProduct, sellableQuantity } from "@/lib/stock-reservation";
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
  const soldOut = inventory.rows.filter((row) => row.quantity === 0);
  const discontinued = inventory.rows.filter((row) => row.productStatus !== "active" && row.quantity > 0);
  const unavailableIds = new Set([...soldOut, ...discontinued].map((row) => row.productId));
  const change = inventory.rows.filter((row) =>
    !unavailableIds.has(row.productId) &&
    (row.listingType === "SINGLE" || row.previousQuantity !== null || row.previousPrice !== null) &&
    (row.previousQuantity !== row.quantity || priceChanged(row.price, row.previousPrice)),
  );

  return {
    create,
    change,
    unavailable: [
      ...soldOut.map((row) => ({ ...row, reason: row.listingType === "VARIATION_OPTION" ? "옵션 품절" as const : "단품 품절" as const })),
      ...discontinued.map((row) => ({ ...row, reason: row.listingType === "VARIATION_OPTION" ? "옵션 판매중지" as const : "단품 판매중지" as const })),
    ],
    summary: {
      createReady: create.length,
      createNeedsReview: preparationCount,
      createCountMeaning: "eBay 필수 검증을 모두 통과한 등록 초안 수",
      unavailableOptions: [...soldOut, ...discontinued].filter((row) => row.listingType === "VARIATION_OPTION").length,
      unavailableSingles: [...soldOut, ...discontinued].filter((row) => row.listingType === "SINGLE").length,
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
    const quantity = product.status === "active" ? sellableQuantity({ stock: product.stockQuantity, reserved: reserved.get(product.id) ?? 0, safetyStock: product.safetyStock }) : 0;
    const price = settings ? Number(resolveListingPriceUsd(product, settings)?.priceUsd ?? 0) || null : null;
    return { productId: product.id, sku: product.sku, productName: product.productName, itemId: listing?.externalId ?? product.shopifyProductId ?? "-", quantity, price, previousQuantity: listing?.quantity ?? null, previousPrice: listing?.price == null ? null : Number(listing.price), productStatus: product.status, linked: Boolean(listing?.externalId ?? product.shopifyProductId), product: readyImageById.has(product.id) ? { ...product, imageUrl: readyImageById.get(product.id)! } : product };
  });
  const unlinked = mapped.filter((row) => !row.linked && row.quantity > 0 && row.price !== null);
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
      if (row.quantity === 0) unavailable.push({ ...row, reason: row.productStatus !== "active" ? "단품 판매중지" : "단품 품절", listingType: "SINGLE", productIds: [row.productId] });
      else if (row.previousQuantity !== row.quantity || priceChanged(row.price, row.previousPrice)) change.push({ ...row, listingType: "SINGLE", productIds: [row.productId] });
      continue;
    }
    const unavailableMembers = members.filter((row) => row.quantity === 0);
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
    if (unavailableMembers.length) unavailable.push({ ...groupedRow, reason: `옵션 ${unavailableMembers.length}개 품절·중지` });
    else if (changedMembers.length) change.push(groupedRow);
  }
  return { create, change, unavailable, summary: { shopifyListings: create.length, shopifyVariationListings: createGroups.length, shopifySingleListings: createSingles.length, shopifyOptions: unlinked.length, unavailableOptions: unavailable.filter((row) => row.listingType === "VARIATION").length, unavailableSingles: unavailable.filter((row) => row.listingType === "SINGLE").length }, limits: { createBatch: 50, reviseBatch: 100 } };
}
