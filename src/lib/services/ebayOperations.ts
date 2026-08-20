import "server-only";

import { prisma } from "@/lib/prisma";
import { planEbayInventoryPush } from "@/lib/services/ebayInventoryPush";
import { resolveListingPriceUsd } from "@/lib/listing-price";

const ACTIVE = ["ACTIVE", "PUBLISHED", "LISTED"];

function priceChanged(current: number | null, previous: number | null) {
  if (current === null) return false;
  if (previous === null) return true;
  return Math.abs(current - previous) >= 0.005;
}

export async function getEbayOperations(userId: string) {
  const [drafts, readyProducts, inventory, pricingSettings] = await Promise.all([
    prisma.listingDraft.findMany({
      where: {
        userId,
        status: { in: ["draft", "validated", "failed"] },
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
      take: 500,
    }),
    prisma.product.findMany({
      where: {
        ebayItemId: null,
        OR: [{ listingStatus: null }, { listingStatus: { notIn: ACTIVE } }],
        AND: [
          { OR: [{ imageUrl: { not: null } }, { ebayImageUrls: { isEmpty: false } }] },
          { OR: [{ salePrice: { not: null } }, { ebayPrice: { not: null } }] },
          { OR: [{ stockQuantity: { gt: 0 } }, { pocamarketAvailableCount: { gt: 0 }, isSoldOut: false }] },
        ],
      },
      select: { id: true, sku: true, productName: true, salePrice: true, ebayPrice: true, stockQuantity: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    planEbayInventoryPush(),
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
  ]);

  const newestDraftByProduct = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    if (draft.sourceInventoryId && !newestDraftByProduct.has(draft.sourceInventoryId)) {
      newestDraftByProduct.set(draft.sourceInventoryId, draft);
    }
  }
  const draftRows = [...newestDraftByProduct.values()].map((draft) => ({
    id: draft.id,
    productId: draft.sourceInventoryId,
    sku: draft.sku,
    name: draft.title,
    price: draft.price == null ? null : Number(draft.price),
    quantity: draft.quantity,
    status: draft.status,
    error: draft.errorSummary,
  }));
  const draftProductIds = new Set(draftRows.flatMap(row => row.productId ? [row.productId] : []));
  const create = [
    ...draftRows,
    ...readyProducts.filter(product => !draftProductIds.has(product.id)).map(product => ({
      id: `product:${product.id}`,
      productId: product.id,
      sku: product.sku,
      name: product.productName,
      price: pricingSettings ? Number(resolveListingPriceUsd(product, pricingSettings)?.priceUsd ?? 0) || null : null,
      quantity: Math.max(1, product.stockQuantity),
      status: "준비완료",
      error: null,
    })),
  ];

  const soldOut = inventory.rows.filter((row) => row.quantity === 0);
  const discontinued = inventory.rows.filter((row) => row.productStatus !== "active" && row.quantity > 0);
  const unavailableIds = new Set([...soldOut, ...discontinued].map((row) => row.productId));
  const change = inventory.rows.filter((row) =>
    !unavailableIds.has(row.productId) &&
    (row.previousQuantity !== row.quantity || priceChanged(row.price, row.previousPrice)),
  );

  return {
    create,
    change,
    unavailable: [
      ...soldOut.map((row) => ({ ...row, reason: "품절" as const })),
      ...discontinued.map((row) => ({ ...row, reason: "판매중지" as const })),
    ],
    limits: { createBatch: 50, reviseBatch: 200 },
  };
}
