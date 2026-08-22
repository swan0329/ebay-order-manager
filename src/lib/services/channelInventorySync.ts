import "server-only";

import { getShopifyConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { setShopifyInventoryLevel } from "@/lib/services/shopifyService";
import { reservedByProduct } from "@/lib/stock-reservation";
import { resolveChannelAvailability } from "@/lib/channel-availability";

// 재고가 바뀌면 채널에 올려 둔 수량도 따라가야 한다. 따라가지 않으면 이미 팔린
// 카드가 계속 팔린다. 실제로 재고 한 장짜리 리스팅에서 주문이 세 건 들어왔다.
//
// 올리는 값은 실재고가 아니라 판매 가능 수량이다. 아직 처리하지 않은 주문이 잡아
// 둔 몫을 뺀 값이라야 두 채널이 같은 한 장을 함께 팔지 않는다.

const CANCELLED = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];

export type ChannelInventoryResult = {
  checked: number;
  pushed: number;
  unchanged: number;
  failed: Array<{ sku: string; reason: string }>;
};

export async function syncShopifyInventory(input: {
  productIds?: string[];
  /** 실제로 올리지 않고 무엇이 바뀔지만 본다. */
  dryRun?: boolean;
} = {}): Promise<ChannelInventoryResult & { plan: Array<{ sku: string; stock: number; reserved: number; sellable: number }> }> {
  const products = await prisma.product.findMany({
    where: {
      shopifyInventoryItemId: { not: null },
      ...(input.productIds?.length ? { id: { in: input.productIds } } : {}),
    },
    select: {
      id: true,
      sku: true,
      stockQuantity: true,
      status: true,
      isSoldOut: true,
      pocamarketAvailableCount: true,
      pocamarketSyncedAt: true,
      shopifyInventoryItemId: true,
      shopifyProductId: true,
      shopifyStatus: true,
    },
  });

  if (!products.length) {
    return { checked: 0, pushed: 0, unchanged: 0, failed: [], plan: [] };
  }

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

  const config = input.dryRun ? null : getShopifyConfig();
  const result: ChannelInventoryResult = { checked: products.length, pushed: 0, unchanged: 0, failed: [] };
  const plan: Array<{ sku: string; stock: number; reserved: number; sellable: number }> = [];

  for (const product of products) {
    const productReserved = reserved.get(product.id) ?? 0;
    const availability = resolveChannelAvailability({ status: product.status, stockQuantity: product.stockQuantity, reservedQuantity: productReserved, isSoldOut: product.isSoldOut, pocamarketAvailableCount: product.pocamarketAvailableCount, pocamarketSyncedAt: product.pocamarketSyncedAt });
    const sellable = availability.quantity;
    plan.push({
      sku: product.sku,
      stock: product.stockQuantity,
      reserved: productReserved,
      sellable,
    });

    if (!config || !availability.actionable) {
      result.unchanged += 1;
      continue;
    }
    try {
      await setShopifyInventoryLevel(config, product.shopifyInventoryItemId as string, sellable);
      // ProductListing은 "보내려던 값"이 아니라 Shopify가 실제로 수락한 값만
      // 저장한다. 그래야 운영 화면의 다음 변동 목록도 신뢰할 수 있다.
      // 예전 데이터에는 product ID가 비어 있어도 ProductListing 행은 이미 있을
      // 수 있다. 그 경우에도 기존 행의 수량은 갱신해 채널별 화면이 갈라지지
      // 않게 한다. 새 행 생성에만 외부 상품 ID가 필요하다.
      const shopifyProductId = product.shopifyProductId;
      const existingListing = await prisma.productListing.updateMany({
        where: { productId: product.id, channel: "SHOPIFY" },
        data: {
          quantity: sellable,
          ...(product.shopifyStatus ? { status: product.shopifyStatus } : {}),
        },
      });
      if (existingListing.count === 0 && !shopifyProductId) {
        safeLog("warn", "channel.inventory.listing_missing_product_id", {
          productId: product.id,
          sku: product.sku,
        });
      } else if (existingListing.count === 0) {
        await prisma.productListing.upsert({
          where: {
            productId_channel: { productId: product.id, channel: "SHOPIFY" },
          },
          update: {
            externalId: shopifyProductId as string,
            quantity: sellable,
            status: product.shopifyStatus ?? "ACTIVE",
          },
          create: {
            productId: product.id,
            channel: "SHOPIFY",
            externalId: shopifyProductId as string,
            quantity: sellable,
            status: product.shopifyStatus ?? "ACTIVE",
            metadata: {
              inventoryItemId: product.shopifyInventoryItemId,
              source: "shopify_inventory_sync",
            },
          },
        });
      }
      result.pushed += 1;
    } catch (error) {
      result.failed.push({
        sku: product.sku,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  safeLog("info", "channel.inventory.synced", {
    checked: result.checked,
    pushed: result.pushed,
    failed: result.failed.length,
    dryRun: Boolean(input.dryRun),
  });
  return { ...result, plan };
}
