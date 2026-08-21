import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { reservedByProduct } from "@/lib/stock-reservation";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";
import { upsertShopifyVariationProduct } from "@/lib/services/shopifyService";

export async function uploadShopifyVariationGroup(productIds: string[]) {
  const [storedProducts, readyImages] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } } }),
    getVariationListingReadyImages(),
  ]);
  const readyImageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
  const products = storedProducts.map((product) => ({ ...product, imageUrl: readyImageById.get(product.id) ?? product.imageUrl }));
  if (products.some((product) => !readyImageById.has(product.id))) throw new Error("최종 승인 이미지가 없는 Shopify 옵션이 포함되어 있습니다.");
  const groups = buildVariationListingGroups(products).groups;
  if (groups.length !== 1 || groups[0].products.length !== productIds.length) throw new Error("Shopify 묶음 구성이 변경되었습니다. 목록을 새로고침해 주세요.");
  const group = groups[0];
  const [settings, orderItems] = await Promise.all([
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
    prisma.orderItem.findMany({ where: { productId: { in: productIds }, stockDeducted: false }, select: { productId: true, quantity: true, stockDeducted: true, order: { select: { orderStatus: true, fulfillmentStatus: true } } } }),
  ]);
  if (!settings) throw new Error("가격 설정을 먼저 저장해 주세요.");
  const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  const reserved = reservedByProduct(orderItems.map((line) => ({ productId: line.productId as string, quantity: line.quantity, stockDeducted: line.stockDeducted, orderCancelled: cancelled.includes(line.order.orderStatus) || cancelled.includes(line.order.fulfillmentStatus) })));
  const items = group.products.map((product) => {
    const price = resolveListingPriceUsd(product, settings);
    if (!price) throw new Error(`${product.sku}: 판매가를 계산할 수 없습니다.`);
    const availability = resolveChannelAvailability({ status: product.status, stockQuantity: product.stockQuantity, reservedQuantity: reserved.get(product.id) ?? 0, safetyStock: product.safetyStock, isSoldOut: product.isSoldOut, pocamarketAvailableCount: product.pocamarketAvailableCount, pocamarketSyncedAt: product.pocamarketSyncedAt });
    if (!availability.actionable) throw new Error(`${product.sku}: 포카마켓 재고 확인 후 전송할 수 있습니다.`);
    return {
      sku: product.sku,
      optionName: product.variationName,
      priceUsd: price.priceUsd.toString(),
      quantity: availability.quantity,
      imageUrls: [...new Set([...(product.ebayImageUrls ?? []), product.imageUrl ?? ""].filter(Boolean))],
      variantId: product.shopifyVariantId,
    };
  });
  const existingIds = [...new Set(products.flatMap((product) => product.shopifyProductId ? [product.shopifyProductId] : []))];
  if (existingIds.length > 1) throw new Error("같은 Shopify 묶음에 서로 다른 상품 ID가 연결되어 있습니다.");
  const result = await upsertShopifyVariationProduct(group.title, items, existingIds[0]);
  const variants = new Map(result.variants.map((variant) => [variant.sku, variant]));
  await prisma.$transaction(group.products.flatMap((product) => {
    const variant = variants.get(product.sku)!;
    const item = items.find((candidate) => candidate.sku === product.sku)!;
    // Shopify 상품/옵션 생성 성공과 재고 반영 성공은 별개다. 전자는 즉시 저장해
    // 재시도 때 같은 묶음을 중복 생성하지 않게 하고, 후자는 성공한 옵션만 실제
    // 수량으로 기록한다. 실패 옵션은 quantity=null로 남아 다음 변동 목록에 다시
    // 나타난다.
    const metadata = { variantId: variant.variantId, inventoryItemId: variant.inventoryItemId, groupKey: group.key, optionName: product.variationName, source: "shopify_variation_upload", inventorySynced: variant.inventorySynced, inventoryError: variant.inventoryError };
    return [
      prisma.product.update({ where: { id: product.id }, data: { shopifyProductId: result.productId, shopifyVariantId: variant.variantId, shopifyInventoryItemId: variant.inventoryItemId, shopifyStatus: result.status, shopifyLastUploadedAt: new Date(), shopifyUploadError: variant.inventoryError } }),
      prisma.productListing.upsert({ where: { productId_channel: { productId: product.id, channel: "SHOPIFY" } }, update: { externalId: result.productId, price: item.priceUsd, quantity: variant.inventorySynced ? item.quantity : null, status: result.status, metadata }, create: { productId: product.id, channel: "SHOPIFY", externalId: result.productId, price: item.priceUsd, quantity: variant.inventorySynced ? item.quantity : null, status: result.status, metadata } }),
    ];
  }));
  return {
    ...result,
    succeeded: result.variants.filter((variant) => variant.inventorySynced).length,
    failed: result.variants
      .filter((variant) => !variant.inventorySynced)
      .map((variant) => ({ sku: variant.sku, reason: variant.inventoryError ?? "Shopify 재고 반영 실패" })),
  };
}
