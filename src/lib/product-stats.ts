import {
  aiProductAllowedSql,
  aiProductWorkPending,
} from "@/lib/ai-image-policy";
import "server-only";
import { coalesceInFlightRead } from "@/lib/in-flight-read";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  imageReadySql,
  priceMissingSql,
  registeredSql,
  shopifyRegisteredSql,
  type ProductSalesChannel,
} from "@/lib/product-operations";

export type ProductStats = {
  totalCount: number;
  ownStockCount: number;
  sellableCount: number;
  sellingCount: number;
  listableCount: number;
  firstListingCandidateCount: number;
  relistingCandidateCount: number;
  ownPhotoListableCount: number;
  unitNoMembersCount: number;
  priceMissingCount: number;
  imagePendingCount: number;
  aiImagePendingCount?: number;
  inStockCount: number;
  procurementReadyCount: number;
  procurementListableCount: number;
  inStockListableCount: number;
  stopRequiredCount: number;
  soldOutCount: number;
  reviewCount: number;
};

async function readProductStats(channel: ProductSalesChannel) {
  // 이미지 완료 판정은 product-operations의 넓은 기준(Lens 승인 포함)과 동일하게 맞춘다.
  const imageReady = Prisma.raw(imageReadySql);
  const registrationCondition = Prisma.raw(
    channel === "SHOPIFY" ? shopifyRegisteredSql : registeredSql,
  );
  const registered = Prisma.raw('"isRegistered"');
  const channelProductId = Prisma.raw(
    channel === "SHOPIFY" ? '"shopify_product_id"' : '"ebay_item_id"',
  );
  const priceMissing = Prisma.raw(priceMissingSql);
  const supply = Prisma.raw(
    `("stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0)`,
  );
  const [row] = await prisma.$queryRaw<ProductStats[]>`
    WITH stats_products AS MATERIALIZED (
      SELECT ${aiProductWorkPending(Prisma.raw('"products"."id"'))} AS "aiWorkPending",
        "brand", "stock_quantity", "user_front_image_url", "image_source",
        "ebay_item_id", "shopify_product_id", "option_name", "featured_members",
        "sale_price", "final_listing_price_usd", "pocamarket_available_count",
        "pocamarket_synced_at", ${registrationCondition} AS "isRegistered"
      FROM "products"
    )
    SELECT
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND NOT ${imageReady} AND ${aiProductAllowedSql}
          AND "aiWorkPending"
      )::int AS "aiImagePendingCount",
      COUNT(*) FILTER (WHERE "stock_quantity" > 0)::int AS "ownStockCount",
      COUNT(*) FILTER (WHERE ${supply} AND ${imageReady})::int AS "sellableCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND ${registered}
      )::int AS "sellingCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND NOT ${registered}
      )::int AS "listableCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND NOT ${registered}
          AND COALESCE(${channelProductId}, '') = ''
      )::int AS "firstListingCandidateCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND NOT ${registered}
          AND COALESCE(${channelProductId}, '') <> ''
      )::int AS "relistingCandidateCount",
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
        WHERE ${supply} AND ${imageReady} AND ${priceMissing}
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
          AND ${registered}
      )::int AS "stopRequiredCount",
      COUNT(*) FILTER (
        WHERE "stock_quantity" <= 0
          AND "pocamarket_synced_at" IS NOT NULL
          AND "pocamarket_available_count" = 0
          AND NOT ${registered}
      )::int AS "soldOutCount",
      COUNT(*) FILTER (
        WHERE "pocamarket_synced_at" IS NULL
      )::int AS "reviewCount"
    FROM stats_products
  `;

  return (
    row ?? {
      totalCount: 0,
      ownStockCount: 0,
      sellableCount: 0,
      sellingCount: 0,
      listableCount: 0,
      firstListingCandidateCount: 0,
      relistingCandidateCount: 0,
      ownPhotoListableCount: 0,
      unitNoMembersCount: 0,
      priceMissingCount: 0,
      imagePendingCount: 0,
      inStockCount: 0,
      procurementReadyCount: 0,
      procurementListableCount: 0,
      inStockListableCount: 0,
      stopRequiredCount: 0,
      soldOutCount: 0,
      reviewCount: 0,
    }
  );
}

const sharedProductStats = coalesceInFlightRead(readProductStats);
export function getProductStats(channel: ProductSalesChannel = "EBAY") {
  return sharedProductStats(channel);
}
