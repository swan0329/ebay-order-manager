import "server-only";

import { prisma } from "@/lib/prisma";
import { getEbayConfig } from "@/lib/env";
import { hasListingPrice, resolveListingPriceUsd } from "@/lib/listing-price";
import { reservedByProduct, sellableQuantity } from "@/lib/stock-reservation";
import { reviseEbayPriceQuantity, type ReviseTarget } from "@/lib/services/ebayRevise";

// eBay에 올려 둔 가격과 수량을 우리 값으로 맞춘다.
//
// 수량은 실재고가 아니라 판매 가능 수량이다. 아직 처리하지 않은 주문이 잡아 둔 몫을
// 빼야 이미 팔린 카드가 다시 팔리지 않는다. 가격은 신규등록 파일과 같은 규칙을
// 쓰므로 두 경로가 서로 다른 값을 내지 않는다.

const CANCELLED = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
const ACTIVE = ["ACTIVE", "PUBLISHED", "LISTED"];

export type PushPlanRow = {
  sku: string;
  itemId: string;
  stock: number;
  reserved: number;
  quantity: number;
  price: number | null;
};

export async function planEbayInventoryPush(input: { productIds?: string[] } = {}) {
  const products = await prisma.product.findMany({
    where: {
      ebayItemId: { not: null },
      listingStatus: { in: ACTIVE },
      ...(input.productIds?.length ? { id: { in: input.productIds } } : {}),
    },
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
    const productReserved = reserved.get(product.id) ?? 0;
    // 가격을 못 정하는 상품은 수량만 맞춘다. 값을 지어내지 않는다.
    let price: number | null = null;
    if (settings && hasListingPrice(product)) {
      price = Number(resolveListingPriceUsd(product, settings)?.priceUsd ?? 0) || null;
    }
    if (!price) missingPrice.push(product.sku);

    rows.push({
      sku: product.sku,
      itemId: product.ebayItemId as string,
      stock: product.stockQuantity,
      reserved: productReserved,
      quantity: sellableQuantity({
        stock: product.stockQuantity,
        reserved: productReserved,
        safetyStock: product.safetyStock,
      }),
      price,
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
}) {
  const plan = await planEbayInventoryPush({ productIds: input.productIds });
  const rows = plan.rows.slice(0, Math.max(1, Math.min(200, input.limit ?? 100)));

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
    price: row.price,
  }));
  const result = await reviseEbayPriceQuantity(account, targets);

  return {
    dryRun: false,
    planned: rows.length,
    rows,
    missingPrice: plan.missingPrice,
    succeeded: result.succeeded.length,
    failed: result.failed,
  };
}
