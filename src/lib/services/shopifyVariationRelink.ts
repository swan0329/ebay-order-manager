import "server-only";

import { prisma } from "@/lib/prisma";
import {
  findShopifyProductVariantsBySkus,
  type ShopifyVariantLookup,
} from "@/lib/services/shopifyService";
import { uploadShopifyVariationGroup } from "@/lib/services/shopifyVariationUpload";

type RelinkProduct = {
  id: string;
  sku: string;
  productName: string;
};

export function buildShopifyVariationRelinkPlan(
  products: RelinkProduct[],
  variants: ShopifyVariantLookup[],
  currentShopifyProductId: string,
  targetShopifyProductId: string,
) {
  if (currentShopifyProductId === targetShopifyProductId) {
    throw new Error("현재 연결과 복구 대상 Shopify 상품이 같습니다.");
  }
  const expectedSkus = new Set(products.map((product) => product.sku));
  const targetVariants = variants.filter(
    (variant) =>
      variant.productId === targetShopifyProductId && expectedSkus.has(variant.sku),
  );
  const matchesBySku = new Map<string, ShopifyVariantLookup[]>();
  for (const variant of targetVariants) {
    const matches = matchesBySku.get(variant.sku) ?? [];
    matches.push(variant);
    matchesBySku.set(variant.sku, matches);
  }
  const missingSkus = products
    .filter((product) => !matchesBySku.has(product.sku))
    .map((product) => product.sku);
  const duplicateSkus = [...matchesBySku]
    .filter(([, matches]) => matches.length !== 1)
    .map(([sku]) => sku);
  if (missingSkus.length || duplicateSkus.length) {
    throw new Error(
      [
        missingSkus.length ? `대상 상품에 없는 SKU: ${missingSkus.join(", ")}` : "",
        duplicateSkus.length
          ? `대상 상품에서 중복된 SKU: ${duplicateSkus.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" / "),
    );
  }
  const variantBySku = new Map(
    [...matchesBySku].map(([sku, matches]) => [sku, matches[0]] as const),
  );
  const candidateCounts = new Map<string, Set<string>>();
  for (const variant of variants) {
    if (!expectedSkus.has(variant.sku)) continue;
    const skus = candidateCounts.get(variant.productId) ?? new Set<string>();
    skus.add(variant.sku);
    candidateCounts.set(variant.productId, skus);
  }
  return {
    currentShopifyProductId,
    targetShopifyProductId,
    productCount: products.length,
    products: products.map((product) => {
      const variant = variantBySku.get(product.sku)!;
      return {
        ...product,
        variantId: variant.variantId,
        inventoryItemId: variant.inventoryItemId,
        targetStatus: variant.productStatus,
        currentQuantity: variant.inventoryQuantity,
      };
    }),
    candidates: [...candidateCounts]
      .map(([productId, skus]) => ({ productId, matchedSkuCount: skus.size }))
      .sort((a, b) => b.matchedSkuCount - a.matchedSkuCount),
  };
}

export async function previewShopifyVariationRelink(
  seedProductId: string,
  targetShopifyProductId: string,
) {
  const seed = await prisma.product.findUnique({
    where: { id: seedProductId },
    select: { shopifyProductId: true },
  });
  if (!seed?.shopifyProductId) {
    throw new Error("기준 상품에 기존 Shopify 연결이 없습니다.");
  }
  const products = await prisma.product.findMany({
    where: { shopifyProductId: seed.shopifyProductId },
    select: { id: true, sku: true, productName: true },
    orderBy: { sku: "asc" },
  });
  if (products.length < 2) {
    throw new Error("기존 Shopify 묶음에 연결된 옵션이 두 개 미만입니다.");
  }
  const variants = await findShopifyProductVariantsBySkus(
    products.map((product) => product.sku),
  );
  return buildShopifyVariationRelinkPlan(
    products,
    variants,
    seed.shopifyProductId,
    targetShopifyProductId,
  );
}

export async function relinkShopifyVariationGroup(
  seedProductId: string,
  targetShopifyProductId: string,
  userId: string,
) {
  const plan = await previewShopifyVariationRelink(
    seedProductId,
    targetShopifyProductId,
  );
  const relinkedAt = new Date();
  const productIds = plan.products.map((product) => product.id);
  const previousListings = await prisma.productListing.findMany({
    where: { productId: { in: productIds }, channel: "SHOPIFY" },
  });
  const previousByProductId = new Map(
    previousListings.map((listing) => [listing.productId, listing]),
  );
  await prisma.$transaction(
    plan.products.flatMap((product) => {
      const previous = previousByProductId.get(product.id);
      const previousMetadata =
        previous?.metadata &&
        typeof previous.metadata === "object" &&
        !Array.isArray(previous.metadata)
          ? previous.metadata
          : {};
      const relink = {
        previousExternalId: plan.currentShopifyProductId,
        targetExternalId: plan.targetShopifyProductId,
        relinkedAt: relinkedAt.toISOString(),
        reason: "duplicate_shopify_variation_recovery",
      };
      return [
        prisma.product.update({
          where: { id: product.id },
          data: {
            shopifyProductId: plan.targetShopifyProductId,
            shopifyVariantId: product.variantId,
            shopifyInventoryItemId: product.inventoryItemId,
            shopifyStatus: product.targetStatus,
          },
        }),
        prisma.productListing.upsert({
          where: {
            productId_channel: { productId: product.id, channel: "SHOPIFY" },
          },
          update: {
            externalId: plan.targetShopifyProductId,
            price: null,
            quantity: null,
            status: product.targetStatus,
            metadata: {
              ...previousMetadata,
              variantId: product.variantId,
              inventoryItemId: product.inventoryItemId,
              relink,
            },
          },
          create: {
            productId: product.id,
            channel: "SHOPIFY",
            externalId: plan.targetShopifyProductId,
            status: product.targetStatus,
            metadata: {
              variantId: product.variantId,
              inventoryItemId: product.inventoryItemId,
              relink,
            },
          },
        }),
      ];
    }),
  );

  const result = await uploadShopifyVariationGroup(productIds, userId);
  const refreshedListings = await prisma.productListing.findMany({
    where: { productId: { in: productIds }, channel: "SHOPIFY" },
  });
  await prisma.$transaction(
    refreshedListings.map((listing) => {
      const metadata =
        listing.metadata &&
        typeof listing.metadata === "object" &&
        !Array.isArray(listing.metadata)
          ? listing.metadata
          : {};
      return prisma.productListing.update({
        where: { id: listing.id },
        data: {
          metadata: {
            ...metadata,
            relink: {
              previousExternalId: plan.currentShopifyProductId,
              targetExternalId: plan.targetShopifyProductId,
              relinkedAt: relinkedAt.toISOString(),
              reason: "duplicate_shopify_variation_recovery",
            },
          },
        },
      });
    }),
  );
  return { plan, result };
}
