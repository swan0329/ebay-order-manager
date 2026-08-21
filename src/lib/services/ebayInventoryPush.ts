import "server-only";

import { prisma } from "@/lib/prisma";
import { getEbayConfig } from "@/lib/env";
import { hasListingPrice, resolveListingPriceUsd } from "@/lib/listing-price";
import { reservedByProduct } from "@/lib/stock-reservation";
import { resolveChannelAvailability, type AvailabilityStatus } from "@/lib/channel-availability";
import { reviseEbayPriceQuantity, type ReviseTarget } from "@/lib/services/ebayRevise";
import { getActiveVariationProductListings } from "@/lib/variation-selling-state";

// eBay에 올려 둔 가격과 수량을 우리 값으로 맞춘다.
//
// 수량은 실재고가 아니라 판매 가능 수량이다. 아직 처리하지 않은 주문이 잡아 둔 몫을
// 빼야 이미 팔린 카드가 다시 팔리지 않는다. 가격은 신규등록 파일과 같은 규칙을
// 쓰므로 두 경로가 서로 다른 값을 내지 않는다.

const CANCELLED = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
const ACTIVE = ["ACTIVE", "PUBLISHED", "LISTED"];

export type PushPlanRow = {
  productId: string;
  sku: string;
  productName: string;
  productStatus: string;
  itemId: string;
  stock: number;
  reserved: number;
  safetyStock: number;
  ownSellableQuantity: number;
  pocamarketAvailableCount: number | null;
  pocamarketListingQuantity: number;
  pocamarketSyncedAt: Date | null;
  pocamarketFresh: boolean;
  availabilityStatus: AvailabilityStatus;
  actionable: boolean;
  quantity: number;
  price: number | null;
  previousQuantity: number | null;
  previousPrice: number | null;
  listingType: "SINGLE" | "VARIATION_OPTION";
  parentTitle: string | null;
};

export async function planEbayInventoryPush(input: { productIds?: string[]; userId?: string } = {}) {
  const variationListings = input.userId ? await getActiveVariationProductListings(input.userId) : new Map<string, { itemId: string; title: string }>();
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { ebayItemId: { not: null }, listingStatus: { in: ACTIVE } },
        { productListings: { some: { channel: "EBAY", status: { in: ACTIVE } } } },
        ...(variationListings.size ? [{ id: { in: [...variationListings.keys()] } }] : []),
      ],
      ...(input.productIds?.length ? { id: { in: input.productIds } } : {}),
    },
    include: { productListings: { where: { channel: "EBAY" }, take: 1 } },
  });
  if (!products.length) return { rows: [] as PushPlanRow[], missingPrice: [] as string[] };

  const lines = await prisma.orderItem.findMany({
    where: { productId: { in: products.map((product) => product.id) }, stockDeducted: false },
    select: {
      productId: true,
      quantity: true,
      stockDeducted: true,
      order: { select: { orderStatus: true, fulfillmentStatus: true } },
    },
  });
  const reserved = reservedByProduct(
    lines.map((line) => ({
      productId: line.productId as string,
      quantity: line.quantity,
      stockDeducted: line.stockDeducted,
      orderCancelled:
        CANCELLED.includes(line.order.orderStatus) ||
        CANCELLED.includes(line.order.fulfillmentStatus),
    })),
  );

  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  const rows: PushPlanRow[] = [];
  const missingPrice: string[] = [];

  for (const product of products) {
    const listing = product.productListings[0];
    const variation = variationListings.get(product.id);
    // 옵션상품에 들어간 카드는 예전 단품 Item ID가 남아 있어도 부모 Item ID + SKU로
    // 수정해야 한다. 부모 Item ID만 수량 0으로 보내면 묶음 전체가 내려갈 수 있다.
    const itemId = variation?.itemId ?? listing?.externalId ?? product.ebayItemId;
    if (!itemId) continue;
    const listingMatchesTarget = listing?.externalId === itemId;
    const productReserved = reserved.get(product.id) ?? 0;
    // 가격을 못 정하는 상품은 수량만 맞춘다. 값을 지어내지 않는다.
    let price: number | null = null;
    if (settings && hasListingPrice(product)) {
      price = Number(resolveListingPriceUsd(product, settings)?.priceUsd ?? 0) || null;
    }
    if (!price) missingPrice.push(product.sku);

    const availability = resolveChannelAvailability({
      status: product.status,
      stockQuantity: product.stockQuantity,
      reservedQuantity: productReserved,
      safetyStock: product.safetyStock,
      isSoldOut: product.isSoldOut,
      pocamarketAvailableCount: product.pocamarketAvailableCount,
      pocamarketSyncedAt: product.pocamarketSyncedAt,
    });
    rows.push({
      productId: product.id,
      sku: product.sku,
      productName: product.productName,
      productStatus: product.status,
      itemId,
      stock: product.stockQuantity,
      reserved: productReserved,
      safetyStock: product.safetyStock,
      ownSellableQuantity: availability.ownSellableQuantity,
      pocamarketAvailableCount: availability.pocamarketAvailableCount,
      pocamarketListingQuantity: availability.pocamarketListingQuantity,
      pocamarketSyncedAt: product.pocamarketSyncedAt,
      pocamarketFresh: availability.pocamarketFresh,
      availabilityStatus: availability.availabilityStatus,
      actionable: availability.actionable,
      quantity: availability.quantity,
      price,
      // 예전 단품 ProductListing 값을 묶음 옵션의 이전 값으로 비교하면 모든 옵션이
      // 변동으로 잘못 뜬다. 현재 수정 대상 Item ID와 같은 전송 이력만 기준으로 쓴다.
      previousQuantity: listingMatchesTarget ? listing?.quantity ?? null : null,
      previousPrice: listingMatchesTarget && listing?.price != null ? Number(listing.price) : null,
      listingType: variation ? "VARIATION_OPTION" : "SINGLE",
      parentTitle: variation?.title ?? null,
    });
  }

  return { rows, missingPrice };
}

export async function pushEbayInventory(input: {
  userId: string;
  productIds?: string[];
  /** 실제로 보내지 않고 무엇이 바뀔지만 본다. */
  dryRun?: boolean;
  /** 한 번에 너무 많이 보내지 않도록 자른다. */
  limit?: number;
  /** 재고 자동화에서는 가격을 절대 건드리지 않는다. */
  quantityOnly?: boolean;
}) {
  const plan = await planEbayInventoryPush({ productIds: input.productIds, userId: input.userId });
  // 포카마켓 값이 미확인/오래된 행은 목록에만 보여 주고 외부 수량을 바꾸지 않는다.
  const rows = plan.rows.filter((row) => row.actionable).slice(0, Math.max(1, Math.min(200, input.limit ?? 100)));

  if (input.dryRun || !rows.length) {
    return {
      dryRun: true,
      planned: rows.length,
      rows,
      missingPrice: plan.missingPrice,
      succeeded: 0,
      failed: [] as Array<{ itemId: string; reason: string }>,
    };
  }

  const config = getEbayConfig();
  const account = await prisma.ebayAccount.findFirst({
    where: { userId: input.userId, environment: config.environment === "production" ? "PRODUCTION" : "SANDBOX" },
    orderBy: { updatedAt: "desc" },
  });
  if (!account) throw new Error("eBay 계정이 연결되어 있지 않습니다.");

  const targets: ReviseTarget[] = rows.map((row) => ({
    itemId: row.itemId,
    sku: row.sku,
    quantity: row.quantity,
    price: input.quantityOnly ? null : row.price,
  }));
  const result = await reviseEbayPriceQuantity(account, targets);

  const succeeded = new Set(result.succeeded);
  await Promise.all(rows.filter((row) => succeeded.has(row.itemId)).map((row) =>
    prisma.productListing.upsert({
      where: { productId_channel: { productId: row.productId, channel: "EBAY" } },
      update: {
        quantity: row.quantity,
        ...(input.quantityOnly || row.price === null ? {} : { price: row.price }),
        externalId: row.itemId,
        metadata: { listingType: row.listingType, sku: row.sku },
      },
      create: { productId: row.productId, channel: "EBAY", externalId: row.itemId, quantity: row.quantity, price: input.quantityOnly ? null : row.price, status: "ACTIVE", metadata: { listingType: row.listingType, sku: row.sku } },
    }),
  ));

  return {
    dryRun: false,
    planned: rows.length,
    rows,
    missingPrice: plan.missingPrice,
    succeeded: result.succeeded.length,
    failed: result.failed,
  };
}
