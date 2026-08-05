import "server-only";

import { prisma } from "@/lib/prisma";
import { rankFuzzyTitleMatches } from "@/lib/product-matching";

// eBay에는 올라가 있는데 프로그램의 상품과 연결되지 않은 리스팅을 모아,
// 각 리스팅마다 "이 상품 같습니다" 후보를 제목 유사도로 붙여 돌려준다.
// 자동으로 연결하지 않는다. 확정은 화면에서 사람이 누른다
// (docs/business-rules.md: 사람이 확정한 연결이 자동 결과보다 우선한다).

// 연결이 필요한 상태들. UNMATCHED는 짝을 못 찾은 것,
// TITLE_MATCHED는 제목으로 추정만 해둔 것이라 사람 확인이 남아 있다.
const LINK_PENDING_STATUSES = ["UNMATCHED", "TITLE_MATCHED", "DUPLICATE", "CONFLICT"];

export type LinkCandidate = {
  productId: string;
  sku: string;
  productName: string;
  brand: string | null;
  optionName: string | null;
  category: string | null;
  imageUrl: string | null;
  score: number;
  // 이미 다른 eBay 상품번호가 붙어 있으면 연결이 거부되므로 미리 알려준다.
  alreadyLinkedItemId: string | null;
};

export type UnlinkedListing = {
  listingId: string;
  itemId: string;
  title: string | null;
  imageUrl: string | null;
  sku: string | null;
  priceUsd: string | null;
  quantity: number | null;
  matchStatus: string;
  itemWebUrl: string;
  candidates: LinkCandidate[];
};

export type LinkSuggestions = {
  reportImportedAt: string | null;
  totalPending: number;
  listings: UnlinkedListing[];
};

export async function getEbayLinkSuggestions(
  userId: string,
  limit = 100,
): Promise<LinkSuggestions> {
  const report = await prisma.ebayReportImport.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (!report) {
    return { reportImportedAt: null, totalPending: 0, listings: [] };
  }

  const where = {
    importId: report.id,
    matchStatus: { in: LINK_PENDING_STATUSES },
    // 이미 상품이 확정된 행은 제외한다.
    productId: null,
  };

  const [totalPending, rows] = await Promise.all([
    prisma.ebayActiveListing.count({ where }),
    prisma.ebayActiveListing.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        itemId: true,
        title: true,
        imageUrl: true,
        sku: true,
        price: true,
        quantity: true,
        matchStatus: true,
      },
    }),
  ]);
  if (!rows.length) {
    return {
      reportImportedAt: report.createdAt.toISOString(),
      totalPending,
      listings: [],
    };
  }

  // 후보 상품은 한 번만 읽어 모든 리스팅에 재사용한다. 목록마다 조회하면
  // 상품 수만큼 질의가 늘어 함수 실행 시간이 길어진다.
  // 이미 다른 상품번호가 붙은 상품은 연결이 거부되므로 후보에서 빼, 고를 수 없는
  // 항목이 추천 자리를 차지하지 않게 한다.
  const products = await prisma.product.findMany({
    where: {
      status: { not: "inactive" },
      OR: [{ ebayItemId: null }, { ebayItemId: "" }],
    },
    select: {
      id: true,
      sku: true,
      productName: true,
      optionName: true,
      category: true,
      brand: true,
      memo: true,
      imageUrl: true,
      ebayImageUrls: true,
      ebayItemId: true,
    },
  });

  const listings = rows.map((row) => {
    const candidates = row.title
      ? rankFuzzyTitleMatches(row.title, products, 5).map(({ product, score }) => ({
          productId: product.id,
          sku: product.sku,
          productName: product.productName,
          brand: product.brand,
          optionName: product.optionName,
          category: product.category,
          imageUrl: product.ebayImageUrls[0] ?? product.imageUrl ?? null,
          score: Number(score.toFixed(3)),
          alreadyLinkedItemId: product.ebayItemId,
        }))
      : [];

    return {
      listingId: row.id,
      itemId: row.itemId,
      title: row.title,
      imageUrl: row.imageUrl,
      sku: row.sku,
      priceUsd: row.price?.toString() ?? null,
      quantity: row.quantity,
      matchStatus: row.matchStatus,
      itemWebUrl: `https://www.ebay.com/itm/${row.itemId}`,
      candidates,
    };
  });

  return {
    reportImportedAt: report.createdAt.toISOString(),
    totalPending,
    listings,
  };
}
