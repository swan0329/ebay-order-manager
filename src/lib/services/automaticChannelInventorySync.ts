import "server-only";

import { safeLog } from "@/lib/safe-log";
import { syncShopifyInventory } from "@/lib/services/channelInventorySync";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";

export async function syncInventoryChannelsAfterChange(input: {
  userId: string;
  productIds: string[];
}) {
  const productIds = [...new Set(input.productIds)].filter(Boolean);
  if (!productIds.length) return;

  // 같은 계산 경로의 미리보기를 먼저 남긴 뒤에만 실제 채널 쓰기를 수행한다.
  const [ebayPlan, shopifyPlan] = await Promise.all([
    pushEbayInventory({ userId: input.userId, productIds, dryRun: true, quantityOnly: true }),
    syncShopifyInventory({ productIds, dryRun: true }),
  ]);
  safeLog("info", "channel.inventory.auto_preview", {
    productIds,
    ebay: ebayPlan.rows,
    shopify: shopifyPlan.plan,
  });

  const [ebay, shopify] = await Promise.allSettled([
    pushEbayInventory({ userId: input.userId, productIds, quantityOnly: true }),
    syncShopifyInventory({ productIds }),
  ]);
  safeLog("info", "channel.inventory.auto_completed", {
    productIds,
    ebay:
      ebay.status === "fulfilled"
        ? { succeeded: ebay.value.succeeded, failed: ebay.value.failed }
        : { error: ebay.reason instanceof Error ? ebay.reason.message : String(ebay.reason) },
    shopify:
      shopify.status === "fulfilled"
        ? { pushed: shopify.value.pushed, failed: shopify.value.failed }
        : { error: shopify.reason instanceof Error ? shopify.reason.message : String(shopify.reason) },
  });
}
