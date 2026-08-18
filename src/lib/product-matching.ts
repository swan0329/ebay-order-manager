import { prisma } from "@/lib/prisma";

type JsonRecord = Record<string, unknown>;

export type MatchMethod = "sku" | "item_variation" | "item_id" | "fuzzy_title";

export type ProductForMatching = {
  id: string;
  sku: string;
  // eBay 활성상품 보고서로 상품에 직접 연결해 둔 상품번호. 주문에 SKU가 실려 오지
  // 않을 때 어느 카드인지 가리는 가장 확실한 근거다.
  ebayItemId?: string | null;
  productName: string;
  optionName?: string | null;
  category?: string | null;
  brand?: string | null;
  memo?: string | null;
};

export type ProductMatchCandidate<TProduct extends ProductForMatching = ProductForMatching> = {
  product: TProduct;
  score: number;
};

export type ProductMatchResult<TProduct extends ProductForMatching = ProductForMatching> = {
  product: TProduct | null;
  matchedBy: MatchMethod | null;
  matchScore: number | null;
  candidates: ProductMatchCandidate<TProduct>[];
  reason?: "low_score" | "ambiguous" | "no_candidate";
};

type OrderItemForMatching = {
  id: string;
  title: string;
  sku: string | null;
  rawJson: unknown;
};

type ProductMappingForMatching<TProduct extends ProductForMatching = ProductForMatching> = {
  productId: string;
  ebayItemId: string | null;
  ebayVariationId: string | null;
  normalizedTitle: string | null;
  product: TProduct;
};

export const fuzzyAutoMatchThreshold = 0.82;
const fuzzyAmbiguityMargin = 0.03;
const maxCandidateCount = 5;

const lowValueWords = new Set([
  "official",
  "authentic",
  "photocard",
  "photo",
  "card",
  "pc",
  "kpop",
  "album",
  "new",
  "sealed",
  "pob",
  "preorder",
  "pre",
  "order",
  "benefit",
  "withmuu",
  "soundwave",
  "makestar",
  "lucky",
  "draw",
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstStringFromRecord(record: JsonRecord, keys: string[]) {
  return keys.map((key) => asString(record[key])).find(Boolean) ?? null;
}

export function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[-/()[\]{}]/g, " ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedTitleTokens(value: string | null | undefined) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !lowValueWords.has(token));
}

export function normalizeComparableTitle(value: string | null | undefined) {
  return normalizedTitleTokens(value).join(" ");
}

function productComparableTitle(product: ProductForMatching) {
  return [
    product.brand,
    product.category,
    product.productName,
    product.optionName,
    product.memo,
  ]
    .filter(Boolean)
    .join(" ");
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens)];
}

function fuzzyTitleScore(orderTitle: string, product: ProductForMatching) {
  const orderText = normalizeComparableTitle(orderTitle);
  const productText = normalizeComparableTitle(productComparableTitle(product));

  if (!orderText || !productText) {
    return 0;
  }

  if (orderText === productText) {
    return 1;
  }

  const orderTokens = uniqueTokens(orderText.split(" "));
  const productTokens = uniqueTokens(productText.split(" "));
  const orderSet = new Set(orderTokens);
  const productSet = new Set(productTokens);
  const overlap = productTokens.filter((token) => orderSet.has(token)).length;

  if (!overlap) {
    return 0;
  }

  const union = new Set([...orderTokens, ...productTokens]).size;
  const productCoverage = overlap / productSet.size;
  const orderCoverage = overlap / orderSet.size;
  const jaccard = overlap / union;
  const containsBonus =
    orderText.includes(productText) || productText.includes(orderText) ? 0.08 : 0;

  return Math.min(
    1,
    productCoverage * 0.58 + orderCoverage * 0.22 + jaccard * 0.2 + containsBonus,
  );
}

export function rankFuzzyTitleMatches<TProduct extends ProductForMatching>(
  orderTitle: string,
  products: TProduct[],
  limit = maxCandidateCount,
): ProductMatchCandidate<TProduct>[] {
  return products
    .map((product) => ({
      product,
      score: fuzzyTitleScore(orderTitle, product),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function legacyListingReferenceFromOrderItemRaw(rawJson: unknown) {
  const record = asRecord(rawJson);
  const legacyItemId = firstStringFromRecord(record, ["legacyItemId", "itemId"]);

  if (!legacyItemId) {
    return null;
  }

  return {
    legacyItemId,
    legacyVariationId: firstStringFromRecord(record, [
      "legacyVariationId",
      "variationId",
    ]),
    legacyVariationSku: firstStringFromRecord(record, [
      "legacyVariationSku",
      "variationSku",
      "sku",
    ]),
    marketplaceId: firstStringFromRecord(record, [
      "listingMarketplaceId",
      "marketplaceId",
    ]),
  };
}

function matchByMappedListing<TProduct extends ProductForMatching>(
  item: OrderItemForMatching,
  mappings: ProductMappingForMatching<TProduct>[],
) {
  const reference = legacyListingReferenceFromOrderItemRaw(item.rawJson);

  if (!reference) {
    return null;
  }

  if (reference.legacyVariationId) {
    const variationMatches = mappings.filter(
      (mapping) =>
        mapping.ebayItemId === reference.legacyItemId &&
        mapping.ebayVariationId === reference.legacyVariationId,
    );

    if (variationMatches.length === 1) {
      return {
        product: variationMatches[0].product,
        matchedBy: "item_variation" as const,
      };
    }
  }

  const itemMatches = mappings.filter(
    (mapping) =>
      mapping.ebayItemId === reference.legacyItemId && !mapping.ebayVariationId,
  );

  if (itemMatches.length === 1) {
    return {
      product: itemMatches[0].product,
      matchedBy: "item_id" as const,
    };
  }

  return null;
}

/**
 * 주문이 가리키는 eBay 상품번호와 같은 번호가 저장된 상품을 찾는다.
 *
 * 옵션상품은 여러 카드가 한 상품번호를 함께 쓰므로 하나로 좁혀지지 않는다. 그럴
 * 때는 고르지 않고 넘긴다. 잘못 붙이는 것보다 사람이 고르게 두는 편이 낫다.
 */
function matchByProductItemId<TProduct extends ProductForMatching>(
  item: OrderItemForMatching,
  products: TProduct[],
) {
  const reference = legacyListingReferenceFromOrderItemRaw(item.rawJson);

  if (!reference?.legacyItemId) {
    return null;
  }

  const matches = products.filter(
    (product) => (product.ebayItemId ?? null) === reference.legacyItemId,
  );

  return matches.length === 1 ? matches[0] : null;
}

function matchByMappedTitle<TProduct extends ProductForMatching>(
  item: OrderItemForMatching,
  mappings: ProductMappingForMatching<TProduct>[],
) {
  const normalizedTitle = normalizeComparableTitle(item.title);

  if (!normalizedTitle) {
    return null;
  }

  const titleMatches = mappings.filter(
    (mapping) => mapping.normalizedTitle === normalizedTitle,
  );

  if (titleMatches.length === 1) {
    return titleMatches[0].product;
  }

  return null;
}

export function resolveOrderItemProductMatch<TProduct extends ProductForMatching>(
  item: OrderItemForMatching,
  products: TProduct[],
  mappings: ProductMappingForMatching<TProduct>[] = [],
): ProductMatchResult<TProduct> {
  const sku = item.sku?.trim();

  if (sku) {
    const skuMatch = products.find((product) => product.sku.trim() === sku);

    if (skuMatch) {
      return {
        product: skuMatch,
        matchedBy: "sku",
        matchScore: null,
        candidates: [],
      };
    }
  }

  // 상품에 저장된 eBay 상품번호를 먼저 본다. 매핑 표에 없어도 여기 있으면 확정이다.
  // 이것을 보지 않아 제목 유사도로 떨어졌고, 이름이 같고 포즈만 다른 카드 중
  // 엉뚱한 것에 붙는 일이 있었다.
  const productItemMatch = matchByProductItemId(item, products);

  if (productItemMatch) {
    return {
      product: productItemMatch,
      matchedBy: "item_id",
      matchScore: null,
      candidates: [],
    };
  }

  const listingMatch = matchByMappedListing(item, mappings);

  if (listingMatch) {
    return {
      product: listingMatch.product,
      matchedBy: listingMatch.matchedBy,
      matchScore: null,
      candidates: [],
    };
  }

  const mappedTitleMatch = matchByMappedTitle(item, mappings);

  if (mappedTitleMatch) {
    return {
      product: mappedTitleMatch,
      matchedBy: "fuzzy_title",
      matchScore: 1,
      candidates: [{ product: mappedTitleMatch, score: 1 }],
    };
  }

  const candidates = rankFuzzyTitleMatches(item.title, products, maxCandidateCount);
  const best = candidates[0];

  if (!best) {
    return {
      product: null,
      matchedBy: null,
      matchScore: null,
      candidates,
      reason: "no_candidate",
    };
  }

  const ambiguous = candidates
    .slice(1)
    .some((candidate) => best.score - candidate.score <= fuzzyAmbiguityMargin);

  if (best.score < fuzzyAutoMatchThreshold || ambiguous) {
    return {
      product: null,
      matchedBy: null,
      matchScore: best.score,
      candidates,
      reason: ambiguous ? "ambiguous" : "low_score",
    };
  }

  return {
    product: best.product,
    matchedBy: "fuzzy_title",
    matchScore: best.score,
    candidates,
  };
}

export async function saveManualProductMapping(input: {
  userId: string;
  productId: string;
  rawJson: unknown;
  title: string;
}) {
  const normalizedTitle = normalizeComparableTitle(input.title) || null;
  const reference = legacyListingReferenceFromOrderItemRaw(input.rawJson);
  const mappingWhere = reference?.legacyItemId
    ? {
        userId: input.userId,
        ebayItemId: reference.legacyItemId,
        ebayVariationId: reference.legacyVariationId ?? null,
      }
    : normalizedTitle
      ? {
          userId: input.userId,
          ebayItemId: null,
          ebayVariationId: null,
          normalizedTitle,
        }
      : null;

  if (!mappingWhere) {
    return null;
  }

  const existing = await prisma.productMapping.findFirst({ where: mappingWhere });

  if (existing) {
    return prisma.productMapping.update({
      where: { id: existing.id },
      data: {
        productId: input.productId,
        normalizedTitle,
        source: "manual",
      },
    });
  }

  return prisma.productMapping.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      ebayItemId: reference?.legacyItemId ?? null,
      ebayVariationId: reference?.legacyVariationId ?? null,
      normalizedTitle,
      source: "manual",
    },
  });
}

export async function matchOrderItemsForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      items: {
        where: { productId: null, stockDeducted: false },
        select: {
          id: true,
          title: true,
          sku: true,
          rawJson: true,
        },
      },
    },
  });

  if (!order || !order.items.length) {
    return { matched: 0, needsReview: 0 };
  }

  const products = await prisma.product.findMany({
    where: { status: { not: "inactive" } },
    select: {
      id: true,
      sku: true,
      ebayItemId: true,
      productName: true,
      optionName: true,
      category: true,
      brand: true,
      memo: true,
    },
  });

  if (!products.length) {
    return { matched: 0, needsReview: order.items.length };
  }

  const references = order.items
    .map((item) => legacyListingReferenceFromOrderItemRaw(item.rawJson))
    .filter((reference): reference is NonNullable<typeof reference> =>
      Boolean(reference),
    );
  const normalizedTitles = [
    ...new Set(
      order.items
        .map((item) => normalizeComparableTitle(item.title))
        .filter(Boolean),
    ),
  ];
  const itemIds = [...new Set(references.map((reference) => reference.legacyItemId))];
  const mappingConditions = [
    ...(itemIds.length ? [{ ebayItemId: { in: itemIds } }] : []),
    ...(normalizedTitles.length ? [{ normalizedTitle: { in: normalizedTitles } }] : []),
  ];
  const mappings = mappingConditions.length
    ? await prisma.productMapping.findMany({
        where: {
          userId: order.userId,
          OR: mappingConditions,
        },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              productName: true,
              optionName: true,
              category: true,
              brand: true,
              memo: true,
            },
          },
        },
      })
    : [];
  let matched = 0;
  let needsReview = 0;

  for (const item of order.items) {
    const result = resolveOrderItemProductMatch(item, products, mappings);

    if (!result.product) {
      needsReview += 1;
      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          matchedBy: null,
          matchScore: result.matchScore,
        },
      });
      continue;
    }

    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        productId: result.product.id,
        matchedBy: result.matchedBy,
        matchScore: result.matchScore,
      },
    });
    matched += 1;
  }

  return { matched, needsReview };
}
