import "server-only";
import { prisma } from "@/lib/prisma";
import { getOperationalProductIds, type ProductSalesChannel } from "@/lib/product-operations";
import { hasListingPrice } from "@/lib/listing-price";

export type RegistrationBreakdown = {
  readyCount: number;
  linkedExcludedCount: number;
  priceMissingCount: number;
};

export async function getRegistrationCandidates(channel: ProductSalesChannel, limit: number) {
  const ids = await getOperationalProductIds("listable", channel);
  if (!ids.length) return { products: [], eligibleCount: 0, breakdown: { readyCount: 0, linkedExcludedCount: 0, priceMissingCount: 0 } };
  const products = await prisma.product.findMany({
    where: {
      id: { in: ids },
      OR: channel === "EBAY"
        ? [{ ebayItemId: null }, { ebayItemId: "" }]
        : [{ shopifyProductId: null }, { shopifyProductId: "" }, { shopifyStatus: { equals: "publication_pending", mode: "insensitive" } }],
    },
    select: { id: true, sku: true, salePrice: true, finalListingPriceUsd: true },
    orderBy: { sku: "asc" },
  });
  const eligible = products.filter(hasListingPrice);
  return {
    products: eligible.slice(0, limit),
    eligibleCount: eligible.length,
    // 상단 listable SKU와 자동등록 후보의 차이를 같은 조회 결과로 설명한다.
    // 기존 연결 제외를 먼저 계산하므로 가격 없음과 중복 합산되지 않는다.
    breakdown: {
      readyCount: ids.length,
      linkedExcludedCount: ids.length - products.length,
      priceMissingCount: products.length - eligible.length,
    } satisfies RegistrationBreakdown,
  };
}
