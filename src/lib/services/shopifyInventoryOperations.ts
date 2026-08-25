import "server-only";

import type { Prisma } from "@/generated/prisma";
import { getShopifyConfig } from "@/lib/env";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { prisma } from "@/lib/prisma";
import { reservedByProduct } from "@/lib/stock-reservation";
import { getShopifyInventoryLevel, getShopifyVariantPrices, setShopifyInventoryLevel, updateShopifyVariantPrices } from "@/lib/services/shopifyService";

type OperationAction = "CHANGE" | "UNAVAILABLE";
type ListingMetadata = Record<string, unknown>;

function metadata(value: Prisma.JsonValue | null): ListingMetadata {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ListingMetadata : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function syncShopifyPriceInventory(productIds: string[], action: OperationAction) {
  const config = getShopifyConfig();
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    include: { productListings: { where: { channel: "SHOPIFY" } } },
  });
  if (products.length !== new Set(productIds).size) throw new Error("Shopify 가격·재고 대상 상품을 모두 찾지 못했습니다.");
  // 운영 DB 연결 제한이 1이므로 독립 조회도 순차 실행해 pool 경쟁을 만들지 않는다.
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  const orderItems = await prisma.orderItem.findMany({
    where: { productId: { in: products.map((product) => product.id) }, stockDeducted: false },
    select: { productId: true, quantity: true, stockDeducted: true, order: { select: { orderStatus: true, fulfillmentStatus: true } } },
  });
  const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  const reserved = reservedByProduct(orderItems.map((line) => ({
    productId: line.productId as string,
    quantity: line.quantity,
    stockDeducted: line.stockDeducted,
    orderCancelled: cancelled.includes(line.order.orderStatus) || cancelled.includes(line.order.fulfillmentStatus),
  })));
  const targets = products.map((product) => {
    const canonicalProductId = product.shopifyProductId ?? product.productListings[0]?.externalId ?? null;
    const listing = product.productListings.find((candidate) => candidate.externalId === canonicalProductId) ?? product.productListings[0];
    const previousMetadata = metadata(listing?.metadata ?? null);
    const variantId = product.shopifyVariantId ?? stringValue(previousMetadata.variantId);
    const inventoryItemId = product.shopifyInventoryItemId ?? stringValue(previousMetadata.inventoryItemId);
    if (!canonicalProductId || !variantId || !inventoryItemId) throw new Error(`${product.sku}: Shopify 상품·옵션·재고 연결 ID가 완전하지 않습니다.`);
    const availability = resolveChannelAvailability({
      status: product.status, stockQuantity: product.stockQuantity, reservedQuantity: reserved.get(product.id) ?? 0,
      isSoldOut: product.isSoldOut, pocamarketAvailableCount: product.pocamarketAvailableCount, pocamarketSyncedAt: product.pocamarketSyncedAt,
    });
    if (!availability.actionable) throw new Error(`${product.sku}: 최신 공급 재고가 확인되지 않아 전송하지 않았습니다.`);
    const price = action === "CHANGE" && settings ? resolveListingPriceUsd(product, settings)?.priceUsd.toString() ?? null : null;
    return { product, listing, previousMetadata, productId: canonicalProductId, variantId, inventoryItemId, quantity: availability.quantity, price };
  });

  const priceResults = new Map<string, { synced: boolean; error: string | null }>();
  const priceGroups = new Map<string, typeof targets>();
  for (const target of targets.filter((candidate) => candidate.price)) priceGroups.set(target.productId, [...(priceGroups.get(target.productId) ?? []), target]);
  for (const [productId, group] of priceGroups) {
    try {
      const results = await updateShopifyVariantPrices(config, productId, group.map((target) => ({ variantId: target.variantId, priceUsd: target.price! })));
      for (const result of results) priceResults.set(result.variantId, { synced: result.synced, error: result.synced ? null : `Shopify 실제 가격이 ${result.priceUsd} USD와 일치하지 않습니다.${result.actualPrice ? ` 현재 ${result.actualPrice} USD` : ""}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shopify 가격 변경 실패";
      for (const target of group) priceResults.set(target.variantId, { synced: false, error: message });
    }
  }

  const results: Array<{ productId: string; sku: string; quantity: number; price: string | null; inventorySynced: boolean; priceSynced: boolean; reason: string | null }> = [];
  for (const target of targets) {
    let inventoryError: string | null = null;
    try {
      await setShopifyInventoryLevel(config, target.inventoryItemId, target.quantity);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Shopify 재고 변경 실패";
    }
    const priceResult = target.price ? priceResults.get(target.variantId) ?? { synced: false, error: "Shopify 가격 확인 결과가 없습니다." } : { synced: true, error: null };
    const uploadError = inventoryError ?? priceResult.error;
    const now = new Date();
    await prisma.$transaction([
      prisma.product.update({ where: { id: target.product.id }, data: { shopifyLastUploadedAt: now, shopifyUploadError: uploadError } }),
      prisma.productListing.upsert({
        where: { productId_channel: { productId: target.product.id, channel: "SHOPIFY" } },
        update: {
          externalId: target.productId,
          ...(inventoryError ? {} : { quantity: target.quantity }),
          ...(target.price && priceResult.synced ? { price: target.price } : {}),
          metadata: { ...target.previousMetadata, variantId: target.variantId, inventoryItemId: target.inventoryItemId, inventorySynced: !inventoryError, inventoryError, priceSynced: priceResult.synced, priceError: priceResult.error, operationSyncedAt: now.toISOString() },
        },
        create: {
          productId: target.product.id, channel: "SHOPIFY", externalId: target.productId,
          quantity: inventoryError ? null : target.quantity,
          price: target.price && priceResult.synced ? target.price : null,
          status: target.product.shopifyStatus,
          metadata: { ...target.previousMetadata, variantId: target.variantId, inventoryItemId: target.inventoryItemId, inventorySynced: !inventoryError, inventoryError, priceSynced: priceResult.synced, priceError: priceResult.error, operationSyncedAt: now.toISOString() },
        },
      }),
    ]);
    results.push({ productId: target.product.id, sku: target.product.sku, quantity: target.quantity, price: target.price, inventorySynced: !inventoryError, priceSynced: priceResult.synced, reason: uploadError });
  }
  return {
    succeeded: results.filter((result) => result.inventorySynced && result.priceSynced).length,
    failed: results.filter((result) => !result.inventorySynced || !result.priceSynced).map((result) => ({ sku: result.sku, reason: result.reason ?? "Shopify 가격·재고 확인 실패" })),
    targets: results,
  };
}

/** 외부 쓰기 없이 실제 Shopify 값이 현재 목표와 같은 항목의 내부 기준만 복구한다. */
export async function reconcileShopifyPriceInventory(productIds: string[], action: OperationAction) {
  const config = getShopifyConfig();
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    include: { productListings: { where: { channel: "SHOPIFY" } } },
  });
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  const orderItems = await prisma.orderItem.findMany({
    where: { productId: { in: products.map((product) => product.id) }, stockDeducted: false },
    select: { productId: true, quantity: true, stockDeducted: true, order: { select: { orderStatus: true, fulfillmentStatus: true } } },
  });
  const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  const reserved = reservedByProduct(orderItems.map((line) => ({ productId: line.productId as string, quantity: line.quantity, stockDeducted: line.stockDeducted, orderCancelled: cancelled.includes(line.order.orderStatus) || cancelled.includes(line.order.fulfillmentStatus) })));
  const outcomes = [];
  for (const product of products) {
    const productId = product.shopifyProductId ?? product.productListings[0]?.externalId ?? null;
    const listing = product.productListings.find((candidate) => candidate.externalId === productId) ?? product.productListings[0];
    const previousMetadata = metadata(listing?.metadata ?? null);
    const inventoryItemId = product.shopifyInventoryItemId ?? stringValue(previousMetadata.inventoryItemId);
    const variantId = product.shopifyVariantId ?? stringValue(previousMetadata.variantId);
    if (!productId || !inventoryItemId || !variantId) { outcomes.push({ productId: product.id, sku: product.sku, current: false, reason: "Shopify 연결 ID가 완전하지 않습니다." }); continue; }
    const availability = resolveChannelAvailability({ status: product.status, stockQuantity: product.stockQuantity, reservedQuantity: reserved.get(product.id) ?? 0, isSoldOut: product.isSoldOut, pocamarketAvailableCount: product.pocamarketAvailableCount, pocamarketSyncedAt: product.pocamarketSyncedAt });
    if (!availability.actionable) {
      outcomes.push({ productId: product.id, sku: product.sku, current: false, reason: "최신 공급 재고가 확인되지 않아 실제값과 비교하지 않았습니다." });
      continue;
    }
    const targetPrice = action === "CHANGE" && settings ? resolveListingPriceUsd(product, settings)?.priceUsd.toString() ?? null : null;
    let actualQuantity: number | null;
    let actualPrice: string | null = null;
    try {
      actualQuantity = await getShopifyInventoryLevel(config, inventoryItemId);
      // 가격은 변경 대상일 때만 GraphQL 재조회한다. 같은 helper에 현재 값을 넣어
      // 쓰기 호출을 하면 안 되므로 목록 조회는 별도 product query를 사용한다.
      if (targetPrice) actualPrice = (await getShopifyVariantPrices(config, [variantId])).get(variantId) ?? null;
    } catch (error) {
      outcomes.push({
        productId: product.id,
        sku: product.sku,
        current: false,
        reason: `Shopify 실제값 조회 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      });
      continue;
    }
    const quantityCurrent = actualQuantity === availability.quantity;
    const priceCurrent = !targetPrice || (actualPrice !== null && Math.abs(Number(actualPrice) - Number(targetPrice)) < 0.005);
    if (quantityCurrent && priceCurrent) {
      await prisma.productListing.upsert({
        where: { productId_channel: { productId: product.id, channel: "SHOPIFY" } },
        update: { externalId: productId, quantity: availability.quantity, ...(targetPrice ? { price: targetPrice } : {}), metadata: { ...previousMetadata, variantId, inventoryItemId, inventorySynced: true, inventoryError: null, priceSynced: true, priceError: null, reconciledAt: new Date().toISOString() } },
        create: { productId: product.id, channel: "SHOPIFY", externalId: productId, quantity: availability.quantity, price: targetPrice, status: product.shopifyStatus, metadata: { ...previousMetadata, variantId, inventoryItemId, inventorySynced: true, priceSynced: true, reconciledAt: new Date().toISOString() } },
      });
    }
    outcomes.push({ productId: product.id, sku: product.sku, current: quantityCurrent && priceCurrent, reason: quantityCurrent && priceCurrent ? "Shopify 실제 가격·재고 일치 확인" : `실제값 불일치 · 재고 ${actualQuantity ?? "확인불가"}/${availability.quantity}${targetPrice ? ` · 가격 ${actualPrice ?? "확인불가"}/${targetPrice}` : ""}` });
  }
  return outcomes;
}
