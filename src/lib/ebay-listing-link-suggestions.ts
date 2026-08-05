import "server-only";

import { parseFeaturedMembers } from "@/lib/ebay-listing-fields";
import { prisma } from "@/lib/prisma";
import { normalizeMatchText, rankFuzzyTitleMatches } from "@/lib/product-matching";

// eBay에는 올라가 있는데 프로그램의 상품과 연결되지 않은 리스팅을 모아,
// 각 리스팅마다 "이 상품 같습니다" 후보를 제목 유사도로 붙여 돌려준다.
// 자동으로 연결하지 않는다. 확정은 화면에서 사람이 누른다
// (docs/business-rules.md: 사람이 확정한 연결이 자동 결과보다 우선한다).

// 연결이 필요한 상태들. UNMATCHED는 짝을 못 찾은 것,
// TITLE_MATCHED는 제목으로 추정만 해둔 것이라 사람 확인이 남아 있다.
const LINK_PENDING_STATUSES = ["UNMATCHED", "TITLE_MATCHED", "DUPLICATE", "CONFLICT"];

// 유닛 카드는 optionName이 멤버 이름이 아니라 "unit"이므로 멤버 판정에서 제외한다.
const NON_MEMBER_OPTION_NAMES = new Set(["unit", "group", "all", "ot8", "ot9"]);

// 포토카드는 그룹·앨범 단어가 여러 장에 공통으로 들어가서, 글자 겹침만 보면
// 멤버가 달라도 점수가 높게 나온다. 순위만 낮추면 여전히 목록에 남아 잘못
// 연결하게 되므로, 멤버가 어긋나는 후보는 아예 제외한다.
//
// 사진 비교(사진으로 찾기)가 훨씬 정확하다는 것이 확인됐으므로, 제목 추천은
// 확신이 있는 것만 남기고 나머지는 사진 비교에 맡긴다.
const MIN_TITLE_SCORE = 0.45;

export function productMemberNames(product: {
  optionName?: string | null;
  featuredMembers?: string | null;
}) {
  const featured = parseFeaturedMembers(product.featuredMembers);
  if (featured.length) return featured;

  const option = product.optionName?.trim();
  if (!option || NON_MEMBER_OPTION_NAMES.has(option.toLowerCase())) return [];
  return [option];
}

// 멤버 이름이 리스팅 제목에 하나라도 들어 있는지. 판단할 수 없으면(멤버 정보가
// 없으면) 걸러내지 않고 그대로 둔다.
export function memberMatches(listingTitle: string, memberNames: string[]) {
  if (!memberNames.length) return null;

  const title = normalizeMatchText(listingTitle);
  if (!title) return null;

  return memberNames.some((name) => {
    const normalized = normalizeMatchText(name);
    return normalized.length > 1 && title.includes(normalized);
  });
}

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
  // 이 상품의 멤버가 리스팅 제목에 없음 — 다른 멤버의 카드일 가능성이 크다.
  memberMismatch: boolean;
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

  // 유닛 카드의 실제 멤버는 Prisma 모델에 없는 featured_members 열에 있다.
  // 값이 들어 있는 상품만 나오므로 결과가 작다.
  const featuredRows = await prisma.$queryRaw<
    Array<{ id: string; featuredMembers: string | null }>
  >`
    SELECT "id", "featured_members" AS "featuredMembers"
    FROM "products"
    WHERE COALESCE("featured_members", '') <> ''
  `;
  const featuredById = new Map(
    featuredRows.map((row) => [row.id, row.featuredMembers]),
  );

  const listings = rows.map((row) => {
    const title = row.title;
    const candidates = title
      ? rankFuzzyTitleMatches(title, products, 20)
          // 멤버가 어긋나는 후보는 버린다. 남겨두면 사진을 대충 보고 눌러
          // 다른 멤버 카드에 연결되는 사고가 난다.
          .filter(({ product }) => {
            const members = productMemberNames({
              optionName: product.optionName,
              featuredMembers: featuredById.get(product.id) ?? null,
            });
            return memberMatches(title, members) !== false;
          })
          // 확신이 낮은 것도 버린다. 빈 목록이 틀린 추천보다 낫다.
          .filter(({ score }) => score >= MIN_TITLE_SCORE)
          .slice(0, 5)
          .map(({ product, score }) => ({
            productId: product.id,
            sku: product.sku,
            productName: product.productName,
            brand: product.brand,
            optionName: product.optionName,
            category: product.category,
            imageUrl: product.ebayImageUrls[0] ?? product.imageUrl ?? null,
            score: Number(score.toFixed(3)),
            alreadyLinkedItemId: product.ebayItemId,
            memberMismatch: false,
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
