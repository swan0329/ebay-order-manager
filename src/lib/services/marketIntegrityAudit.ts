import "server-only";

import { resolveChannelAvailability } from "@/lib/channel-availability";
import { getShopifyConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { summarizeActiveReportIssues } from "@/lib/ebay-active-report-summary";
import { shopifyApiRequest } from "@/lib/services/shopifyService";
import { reservedByProduct } from "@/lib/stock-reservation";

type ShopifyRestVariant = {
  id: number;
  sku?: string | null;
  inventory_quantity?: number | null;
  inventory_item_id?: number | null;
  image_id?: number | null;
};

type ShopifyRestProduct = {
  id: number;
  title: string;
  handle?: string | null;
  status?: string | null;
  published_at?: string | null;
  image?: { id?: number | null; src?: string | null } | null;
  images?: Array<{ id: number; src?: string | null }>;
  variants?: ShopifyRestVariant[];
};

async function getAllShopifyProducts() {
  const config = getShopifyConfig();
  const products: ShopifyRestProduct[] = [];
  let sinceId = "0";
  for (let page = 0; page < 100; page += 1) {
    const result = (await shopifyApiRequest(config, {
      path: `/products.json?limit=250&since_id=${sinceId}&fields=id,title,handle,status,published_at,image,images,variants`,
    })) as { products?: ShopifyRestProduct[] };
    const rows = result.products ?? [];
    products.push(...rows);
    if (rows.length < 250) break;
    sinceId = String(rows.at(-1)?.id ?? "");
    if (!sinceId) break;
  }
  return products;
}

function addToMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

export async function getMarketIntegrityAudit(userId: string) {
  const [shopifyProducts, internalProducts, orderItems, latestEbayReport, variationStates] =
    await Promise.all([
      getAllShopifyProducts(),
      prisma.product.findMany({
        where: {
          OR: [
            { shopifyProductId: { not: null } },
            { ebayItemId: { not: null } },
            { productListings: { some: { channel: { in: ["SHOPIFY", "EBAY"] } } } },
          ],
        },
        include: { productListings: true },
      }),
      prisma.orderItem.findMany({
        where: { productId: { not: null }, stockDeducted: false },
        select: {
          productId: true,
          quantity: true,
          stockDeducted: true,
          order: { select: { orderStatus: true, fulfillmentStatus: true } },
        },
      }),
      prisma.ebayReportImport.findFirst({
        where: { userId, completeSnapshot: true },
        orderBy: { createdAt: "desc" },
        include: { listings: true },
      }),
      prisma.variationListingState.findMany({
        where: { userId, ebayItemId: { not: null } },
        select: { ebayItemId: true, parentSku: true, title: true, includedProductIds: true },
      }),
    ]);

  const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  const reserved = reservedByProduct(
    orderItems.flatMap((line) =>
      line.productId
        ? [{
            productId: line.productId,
            quantity: line.quantity,
            stockDeducted: line.stockDeducted,
            orderCancelled:
              cancelled.includes(line.order.orderStatus) ||
              cancelled.includes(line.order.fulfillmentStatus),
          }]
        : [],
    ),
  );

  const shopifyById = new Map(shopifyProducts.map((product) => [String(product.id), product]));
  const shopifyVariantsBySku = new Map<string, Array<{ product: ShopifyRestProduct; variant: ShopifyRestVariant }>>();
  for (const product of shopifyProducts) {
    for (const variant of product.variants ?? []) {
      const sku = variant.sku?.trim();
      if (sku) addToMap(shopifyVariantsBySku, sku, { product, variant });
    }
  }

  const internalBySku = new Map(internalProducts.map((product) => [product.sku, product]));
  const internallyLinkedShopifyIds = new Set(
    internalProducts.flatMap((product) => {
      const listing = product.productListings.find((row) => row.channel === "SHOPIFY");
      return [product.shopifyProductId, listing?.externalId].filter((id): id is string => Boolean(id));
    }),
  );
  const duplicateShopifySkus = [...shopifyVariantsBySku]
    .filter(([, rows]) => new Set(rows.map((row) => String(row.product.id))).size > 1)
    .map(([sku, rows]) => ({
      sku,
      products: [...new Map(rows.map((row) => [String(row.product.id), {
        productId: String(row.product.id), title: row.product.title, status: row.product.status,
        published: Boolean(row.product.published_at),
      }])).values()],
    }));
  const skuSetBuckets = new Map<string, ShopifyRestProduct[]>();
  for (const product of shopifyProducts) {
    const skus = (product.variants ?? []).flatMap((variant) => variant.sku?.trim() ? [variant.sku.trim()] : []).sort();
    if (skus.length) addToMap(skuSetBuckets, skus.join("|"), product);
  }
  const duplicateShopifyProducts = [...skuSetBuckets]
    .filter(([, rows]) => rows.length > 1)
    .map(([skuSet, rows]) => ({
      skus: skuSet.split("|"),
      products: rows.map((row) => ({ productId: String(row.id), title: row.title, status: row.status, published: Boolean(row.published_at) })),
    }));
  const shopifyImageIssues = shopifyProducts.flatMap((product) => {
    const variants = (product.variants ?? []).filter((variant) => variant.sku?.trim());
    if (variants.length < 2) return [];
    const missing = variants.filter((variant) => !variant.image_id).map((variant) => variant.sku!);
    const byImage = new Map<string, string[]>();
    for (const variant of variants) {
      if (variant.image_id) addToMap(byImage, String(variant.image_id), variant.sku!);
    }
    const shared = [...byImage].filter(([, skus]) => skus.length > 1).map(([imageId, skus]) => ({ imageId, skus }));
    if (!missing.length && !shared.length) return [];
    return [{ productId: String(product.id), title: product.title, status: product.status, published: Boolean(product.published_at), optionCount: variants.length, missingImageSkus: missing, sharedImages: shared }];
  });
  const shopifyConnectionIssues = internalProducts.flatMap((product) => {
    const listing = product.productListings.find((row) => row.channel === "SHOPIFY");
    const canonical = product.shopifyProductId ?? listing?.externalId ?? null;
    const reasons: string[] = [];
    if (product.shopifyProductId && listing?.externalId && product.shopifyProductId !== listing.externalId) reasons.push("Product와 ProductListing의 Shopify 상품번호가 다름");
    if (canonical && !shopifyById.has(canonical)) reasons.push("연결된 Shopify 상품이 존재하지 않음");
    const actual = canonical ? (shopifyById.get(canonical)?.variants ?? []).filter((variant) => variant.sku === product.sku) : [];
    if (canonical && actual.length !== 1) reasons.push(actual.length ? "연결 상품 안에서 SKU가 중복됨" : "연결 상품 안에 SKU가 없음");
    if (!reasons.length) return [];
    return [{ sku: product.sku, productName: product.productName, shopifyProductId: canonical, reasons }];
  });
  const shopifyQuantityIssues = internalProducts.flatMap((product) => {
    const listing = product.productListings.find((row) => row.channel === "SHOPIFY");
    const canonical = product.shopifyProductId ?? listing?.externalId ?? null;
    if (!canonical) return [];
    const actualVariant = (shopifyById.get(canonical)?.variants ?? []).find((variant) => variant.sku === product.sku);
    if (!actualVariant || actualVariant.inventory_quantity == null) return [];
    const expected = resolveChannelAvailability({
      status: product.status,
      stockQuantity: product.stockQuantity,
      reservedQuantity: reserved.get(product.id) ?? 0,
      isSoldOut: product.isSoldOut,
      pocamarketAvailableCount: product.pocamarketAvailableCount,
      pocamarketSyncedAt: product.pocamarketSyncedAt,
    });
    if (!expected.actionable || expected.quantity === actualVariant.inventory_quantity) return [];
    return [{ sku: product.sku, productName: product.productName, productId: canonical, expectedQuantity: expected.quantity, actualQuantity: actualVariant.inventory_quantity, availabilityStatus: expected.availabilityStatus }];
  });
  const orphanedShopifyProducts = shopifyProducts.flatMap((product) => {
    const skus = (product.variants ?? []).flatMap((variant) => variant.sku?.trim() ? [variant.sku.trim()] : []);
    if (internallyLinkedShopifyIds.has(String(product.id)) || !skus.some((sku) => internalBySku.has(sku))) return [];
    return [{ productId: String(product.id), title: product.title, status: product.status, published: Boolean(product.published_at), skus }];
  });

  const ebayListings = latestEbayReport?.listings ?? [];
  const variationItemIds = new Set(variationStates.flatMap((state) => state.ebayItemId ? [state.ebayItemId] : []));
  const ebaySummary = summarizeActiveReportIssues(ebayListings, variationItemIds);
  const ebaySkuBuckets = new Map<string, typeof ebayListings>();
  for (const listing of ebayListings) if (listing.sku) addToMap(ebaySkuBuckets, listing.sku, listing);
  const duplicateEbaySkus = [...ebaySkuBuckets]
    .filter(([, rows]) => new Set(rows.map((row) => row.itemId)).size > 1)
    .map(([sku, rows]) => ({ sku, listings: rows.map((row) => ({ itemId: row.itemId, title: row.title, quantity: row.quantity })) }));
  const ebayProductBuckets = new Map<string, typeof ebayListings>();
  for (const listing of ebayListings) if (listing.productId) addToMap(ebayProductBuckets, listing.productId, listing);
  const multiplyLinkedEbayProducts = [...ebayProductBuckets]
    .filter(([, rows]) => new Set(rows.map((row) => row.itemId)).size > 1)
    .map(([, rows]) => ({ productId: rows[0].productId, itemIds: [...new Set(rows.map((row) => row.itemId))], sku: rows[0].sku }));
  const ebayQuantityIssues = ebayListings.flatMap((listing) => {
    if (!listing.productId || variationItemIds.has(listing.itemId) || listing.quantity == null) return [];
    const product = internalProducts.find((row) => row.id === listing.productId);
    if (!product) return [];
    const expected = resolveChannelAvailability({
      status: product.status,
      stockQuantity: product.stockQuantity,
      reservedQuantity: reserved.get(product.id) ?? 0,
      isSoldOut: product.isSoldOut,
      pocamarketAvailableCount: product.pocamarketAvailableCount,
      pocamarketSyncedAt: product.pocamarketSyncedAt,
    });
    if (!expected.actionable || expected.quantity === listing.quantity) return [];
    return [{ itemId: listing.itemId, sku: product.sku, productName: product.productName, expectedQuantity: expected.quantity, actualQuantity: listing.quantity, availabilityStatus: expected.availabilityStatus }];
  });
  const missingVariationParents = variationStates.filter((state) => !ebayListings.some((listing) => listing.itemId === state.ebayItemId));

  return {
    checkedAt: new Date().toISOString(),
    shopify: {
      totals: { products: shopifyProducts.length, variants: shopifyProducts.reduce((sum, product) => sum + (product.variants?.length ?? 0), 0), internallyLinkedProducts: internallyLinkedShopifyIds.size },
      duplicateProducts: duplicateShopifyProducts,
      duplicateSkus: duplicateShopifySkus,
      orphanedProducts: orphanedShopifyProducts,
      connectionIssues: shopifyConnectionIssues,
      quantityIssues: shopifyQuantityIssues,
      imageIssues: shopifyImageIssues,
    },
    ebay: {
      report: latestEbayReport ? { createdAt: latestEbayReport.createdAt.toISOString(), rowCount: latestEbayReport.rowCount, matchedCount: latestEbayReport.matchedCount, completeSnapshot: latestEbayReport.completeSnapshot } : null,
      actionRequired: { unmatchedCount: ebaySummary.unmatchedCount, duplicateOrConflictCount: ebaySummary.duplicateCount, variationMatchedCount: ebaySummary.variationMatchedCount },
      duplicateSkus: duplicateEbaySkus,
      multiplyLinkedProducts: multiplyLinkedEbayProducts,
      quantityIssues: ebayQuantityIssues,
      missingVariationParents: missingVariationParents.map((state) => ({ itemId: state.ebayItemId, parentSku: state.parentSku, title: state.title })),
    },
  };
}
