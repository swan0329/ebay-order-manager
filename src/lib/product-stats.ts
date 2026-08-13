import "server-only";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { imageReadySql, priceMissingSql, registeredSql } from "@/lib/product-operations";

export type ProductStats = {
  totalCount: number;
  sellableCount: number;
  sellingCount: number;
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
  soldOutCount: number;
  reviewCount: number;
};

export async function getProductStats() {
  // 이미지 완료 판정은 product-operations의 넓은 기준(Lens 승인 포함)과 동일하게 맞춘다.
  const imageReady = Prisma.raw(imageReadySql);
  const registered = Prisma.raw(registeredSql);
  const priceMissing = Prisma.raw(priceMissingSql);
  const supply = Prisma.raw(
    `("stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0)`,
  );
  const [row] = await prisma.$queryRaw<ProductStats[]>`
    SELECT
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (WHERE ${supply} AND ${imageReady})::int AS "sellableCount",
      COUNT(*) FILTER (
        WHERE ${supply} AND ${imageReady} AND ${registered}
      )::int AS "sellingCount",
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
          AND "pocamarket_available_count" = 0
          AND NOT (
            COALESCE("ebay_item_id", '') <> ''
            AND UPPER(COALESCE("listing_status", 'ACTIVE')) IN ('ACTIVE','PUBLISHED','LISTED')
          )
      )::int AS "soldOutCount",
      COUNT(*) FILTER (
        WHERE "pocamarket_synced_at" IS NULL
      )::int AS "reviewCount"
    FROM "products"
  `;

  return (
    row ?? {
      totalCount: 0,
      sellableCount: 0,
      sellingCount: 0,
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
      soldOutCount: 0,
      reviewCount: 0,
    }
  );
}
