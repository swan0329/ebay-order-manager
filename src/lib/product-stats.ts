import "server-only";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { imageReadySql, priceMissingSql, registeredSql } from "@/lib/product-operations";
import { getActiveVariationSellingState } from "@/lib/variation-selling-state";

export type ProductStats = {
  totalCount: number;
  sellableCount: number;
  sellingCount: number;
  standaloneSellingCount: number;
  variationSellingCount: number;
  duplicateSellingCount: number;
  activeListingCount: number;
  activeStandaloneListingCount: number;
  activeVariationListingCount: number;
  listableCount: number;
  ownPhotoListableCount: number;
  unitNoMembersCount: number;
  priceMissingCount: number;
  imagePendingCount: number;
  inStockCount: number;
  procurementReadyCount: number;
  procurementListableCount: number;
  inStockListableCount: number;
  stopRequiredCount: number;
  variationStopRequiredCount: number;
  soldOutCount: number;
  reviewCount: number;
};

export async function getProductStats(userId: string) {
  // 이미지 완료 판정은 product-operations의 넓은 기준(Lens 승인 포함)과 동일하게 맞춘다.
  const imageReady = Prisma.raw(imageReadySql);
  const directlyRegistered = Prisma.raw(registeredSql);
  const variationState = await getActiveVariationSellingState(userId);
  const variationRegistered = variationState.productIds.length
    ? Prisma.sql`"products"."id" IN (${Prisma.join(variationState.productIds)})`
    : Prisma.sql`FALSE`;
  const registered = Prisma.sql`(${directlyRegistered} OR ${variationRegistered})`;
  const priceMissing = Prisma.raw(priceMissingSql);
  const supply = Prisma.raw(
    `("stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0)`,
  );
  const [row] = await prisma.$queryRaw<ProductStats[]>`
    SELECT
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (WHERE ${supply} AND ${imageReady})::int AS "sellableCount",
      COUNT(*) FILTER (
        WHERE ${registered}
      )::int AS "sellingCount",
      COUNT(*) FILTER (
        WHERE ${directlyRegistered}
      )::int AS "standaloneSellingCount",
      COUNT(*) FILTER (
        WHERE ${variationRegistered}
      )::int AS "variationSellingCount",
      COUNT(*) FILTER (
        WHERE ${directlyRegistered} AND ${variationRegistered}
      )::int AS "duplicateSellingCount",
      COUNT(DISTINCT "ebay_item_id") FILTER (WHERE ${directlyRegistered})::int AS "activeStandaloneListingCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND NOT ${registered}
      )::int AS "listableCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" > 0
          AND COALESCE("user_front_image_url", '') <> ''
          AND NOT ${registered}
      )::int AS "ownPhotoListableCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND NOT ${registered}
          AND LOWER(TRIM(COALESCE("option_name", ''))) = 'unit'
          AND COALESCE("featured_members", '') = ''
      )::int AS "unitNoMembersCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND NOT ${registered} AND ${priceMissing}
      )::int AS "priceMissingCount",
      COUNT(*) FILTER (WHERE ${supply} AND NOT ${imageReady})::int AS "imagePendingCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" > 0 AND ${imageReady}
      )::int AS "inStockCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" <= 0
          AND COALESCE("pocamarket_available_count", 0) > 0
          AND ${imageReady}
      )::int AS "procurementReadyCount",
      -- "판매 가능"을 공급처별로 나눈 두 조각. 둘을 더하면 listableCount가 된다.
      COUNT(*) FILTER (
        WHERE "stock_quantity" <= 0
          AND COALESCE("pocamarket_available_count", 0) > 0
          AND ${imageReady} AND NOT ${registered}
      )::int AS "procurementListableCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" > 0 AND ${imageReady} AND NOT ${registered}
      )::int AS "inStockListableCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" <= 0
          AND "pocamarket_synced_at" IS NOT NULL
          AND "pocamarket_available_count" = 0
          AND COALESCE("ebay_item_id", '') <> ''
          AND UPPER(COALESCE("listing_status", 'ACTIVE'))
            IN ('ACTIVE','PUBLISHED','LISTED')
      )::int AS "stopRequiredCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" <= 0
          AND "pocamarket_synced_at" IS NOT NULL
          AND COALESCE("pocamarket_available_count", 0) = 0
          AND ${variationRegistered}
      )::int AS "variationStopRequiredCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" <= 0
          AND "pocamarket_synced_at" IS NOT NULL
          AND "pocamarket_available_count" = 0
          AND NOT ${registered}
      )::int AS "soldOutCount",
      COUNT(*) FILTER (
        WHERE "pocamarket_synced_at" IS NULL
      )::int AS "reviewCount"
    FROM "products"
  `;

  const base = row ?? {
      totalCount: 0,
      sellableCount: 0,
      sellingCount: 0,
      standaloneSellingCount: 0,
      variationSellingCount: 0,
      duplicateSellingCount: 0,
      activeStandaloneListingCount: 0,
      listableCount: 0,
      ownPhotoListableCount: 0,
      unitNoMembersCount: 0,
      priceMissingCount: 0,
      imagePendingCount: 0,
      inStockCount: 0,
      procurementReadyCount: 0,
      procurementListableCount: 0,
      inStockListableCount: 0,
      stopRequiredCount: 0,
      variationStopRequiredCount: 0,
      soldOutCount: 0,
      reviewCount: 0,
    };
  return {
    ...base,
    activeVariationListingCount: variationState.listingCount,
    activeListingCount: base.activeStandaloneListingCount + variationState.listingCount,
  };
}
