import "server-only";

import { resolveChannelAvailability } from "@/lib/channel-availability";
import { getEbayConfig, getShopifyConfig } from "@/lib/env";
import { getValidAccessToken } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { summarizeActiveReportIssues } from "@/lib/ebay-active-report-summary";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
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

function xmlValue(xml: string, tag: string) {
  return new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "i").exec(xml)?.[1]?.trim() ?? "";
}

function xmlBlocks(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "gi"))].map((match) => match[1]);
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
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
  const ebayAccount = variationStates.length ? await getActiveEbayInventoryAccount(userId) : null;
  const ebayToken = ebayAccount ? await getValidAccessToken(ebayAccount) : null;
  const ebayConfig = getEbayConfig();
  const internalById = new Map(internalProducts.map((product) => [product.id, product]));
  const ebayVariationInspections = await mapWithConcurrency(variationStates, 3, async (state) => {
    const itemId = state.ebayItemId!;
    try {
      const response = await fetch(`${ebayConfig.hosts.api}/ws/api.dll`, {
        method: "POST",
        headers: {
          "content-type": "text/xml;charset=UTF-8",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
          "X-EBAY-API-CALL-NAME": "GetItem",
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-IAF-TOKEN": ebayToken!,
        },
        body: `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><IncludeItemSpecifics>true</IncludeItemSpecifics></GetItemRequest>`,
        signal: AbortSignal.timeout(20_000),
      });
      const xml = await response.text();
      if (!response.ok || xmlValue(xml, "Ack") === "Failure") throw new Error(`HTTP ${response.status}`);
      const item = xmlValue(xml, "Item") || xml;
      const variationsXml = xmlValue(item, "Variations");
      const variations = xmlBlocks(variationsXml, "Variation").map((block) => {
        const specifics = xmlBlocks(xmlValue(block, "VariationSpecifics"), "NameValueList").map((specific) => ({ name: xmlValue(specific, "Name"), value: xmlValue(specific, "Value") }));
        const quantity = Number(xmlValue(block, "Quantity"));
        const sold = Number(xmlValue(block, "QuantitySold") || 0);
        return { sku: xmlValue(block, "SKU"), specifics, availableQuantity: quantity - sold };
      });
      const pictures = xmlValue(variationsXml, "Pictures");
      const pictureSpecificName = xmlValue(pictures, "VariationSpecificName");
      const pictureValues = new Set(xmlBlocks(pictures, "VariationSpecificPictureSet").flatMap((block) => {
        const value = xmlValue(block, "VariationSpecificValue");
        const urls = xmlBlocks(block, "PictureURL");
        return value && urls.length ? [value] : [];
      }));
      const expectedProducts = (Array.isArray(state.includedProductIds) ? state.includedProductIds : [])
        .flatMap((id) => typeof id === "string" && internalById.has(id) ? [internalById.get(id)!] : []);
      const expectedSkus = new Set(expectedProducts.map((product) => product.sku));
      const actualSkuCounts = new Map<string, number>();
      for (const variation of variations) if (variation.sku) actualSkuCounts.set(variation.sku, (actualSkuCounts.get(variation.sku) ?? 0) + 1);
      const actualSkus = new Set(actualSkuCounts.keys());
      const missingImageSkus = variations.flatMap((variation) => {
        const pictureValue = variation.specifics.find((specific) => specific.name === pictureSpecificName)?.value;
        return !pictureSpecificName || !pictureValue || !pictureValues.has(pictureValue) ? [variation.sku || "(SKU 없음)"] : [];
      });
      const quantityIssues = expectedProducts.flatMap((product) => {
        const actual = variations.find((variation) => variation.sku === product.sku);
        if (!actual || !Number.isFinite(actual.availableQuantity)) return [];
        const expected = resolveChannelAvailability({ status: product.status, stockQuantity: product.stockQuantity, reservedQuantity: reserved.get(product.id) ?? 0, isSoldOut: product.isSoldOut, pocamarketAvailableCount: product.pocamarketAvailableCount, pocamarketSyncedAt: product.pocamarketSyncedAt });
        return expected.actionable && expected.quantity !== actual.availableQuantity
          ? [{ sku: product.sku, expected: expected.quantity, actual: actual.availableQuantity }]
          : [];
      });
      return {
        itemId,
        parentSku: state.parentSku,
        title: state.title,
        optionCount: variations.length,
        missingExpectedSkus: [...expectedSkus].filter((sku) => !actualSkus.has(sku)),
        unexpectedSkus: [...actualSkus].filter((sku) => !expectedSkus.has(sku)),
        duplicateSkus: [...actualSkuCounts].filter(([, count]) => count > 1).map(([sku]) => sku),
        missingImageSkus,
        quantityIssues,
        error: null,
      };
    } catch (error) {
      return { itemId, parentSku: state.parentSku, title: state.title, optionCount: 0, missingExpectedSkus: [], unexpectedSkus: [], duplicateSkus: [], missingImageSkus: [], quantityIssues: [], error: error instanceof Error ? error.message : "조회 실패" };
    }
  });
  const ebayVariationSkuBuckets = new Map<string, typeof ebayVariationInspections>();
  for (const inspection of ebayVariationInspections) {
    if (inspection.error || !inspection.optionCount) continue;
    const fingerprint = stateFingerprint(inspection, internalById, variationStates);
    if (fingerprint) addToMap(ebayVariationSkuBuckets, fingerprint, inspection);
  }
  const duplicateEbayVariationProducts = [...ebayVariationSkuBuckets]
    .filter(([, rows]) => rows.length > 1)
    .map(([, rows]) => rows.map((row) => ({ itemId: row.itemId, parentSku: row.parentSku, title: row.title })));

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
      variationAudit: {
        inspectedCount: ebayVariationInspections.filter((row) => !row.error).length,
        errorCount: ebayVariationInspections.filter((row) => row.error).length,
        duplicateProducts: duplicateEbayVariationProducts,
        skuIssues: ebayVariationInspections.filter((row) => row.missingExpectedSkus.length || row.unexpectedSkus.length || row.duplicateSkus.length),
        imageIssues: ebayVariationInspections.filter((row) => row.missingImageSkus.length).map((row) => ({ itemId: row.itemId, parentSku: row.parentSku, title: row.title, missingImageSkus: row.missingImageSkus })),
        quantityIssues: ebayVariationInspections.filter((row) => row.quantityIssues.length).map((row) => ({ itemId: row.itemId, parentSku: row.parentSku, title: row.title, issues: row.quantityIssues })),
        errors: ebayVariationInspections.filter((row) => row.error).map((row) => ({ itemId: row.itemId, error: row.error })),
      },
    },
  };
}

function stateFingerprint(
  inspection: { itemId: string },
  internalById: Map<string, { sku: string }>,
  states: Array<{ ebayItemId: string | null; includedProductIds: unknown }>,
) {
  const state = states.find((row) => row.ebayItemId === inspection.itemId);
  return (Array.isArray(state?.includedProductIds) ? state.includedProductIds : [])
    .flatMap((id) => typeof id === "string" && internalById.has(id) ? [internalById.get(id)!.sku] : [])
    .sort()
    .join("|");
}
