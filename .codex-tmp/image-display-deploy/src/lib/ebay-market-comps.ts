import "server-only";

import { ebayApplicationFetch } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import {
  albumQueryTokens,
  analyzePhotocardTitleMatch,
  groupNames,
  memberQueryName,
  type PhotocardMatchProduct,
  type PhotocardMatchTier,
  type PhotocardTitleMatch,
} from "@/lib/photocard-title-match";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";

// eBay에 실제로 올라와 있는 같은 카드의 판매가를 찾아 "가격 참고 후보"를 만든다.
// 사람이 구글 렌즈로 하던 일을 eBay Browse API로 대신하는 것이며, 여기서 정해진
// 가격을 상품에 자동 반영하지 않는다. 채택은 화면에서 사람이 한다
// (docs/business-rules.md 가격 계산: 계산만으로 eBay 가격을 바꾸지 않는다).
//
// 같은 카드인지 판정하는 규칙은 @/lib/photocard-title-match 한 곳에 있다.
// 여기서는 "무엇으로 찾을지"와 "어떤 순서로 보여줄지"만 정한다.

export type MarketComp = {
  itemId: string;
  // eBay 화면·보고서에서 쓰는 숫자 형태의 상품번호. 내 리스팅 대조에 쓴다.
  legacyItemId: string | null;
  title: string;
  priceUsd: number;
  shippingUsd: number | null;
  // 배송비까지 더한 구매자 실제 부담액. 최저가 비교는 이 값으로 해야 공정하다.
  totalUsd: number;
  condition: string | null;
  imageUrl: string | null;
  itemWebUrl: string | null;
  sellerUsername: string | null;
  // 내가 이미 eBay에 올려둔 리스팅인지. 시세 기준으로 삼으면 자기 가격을 다시
  // 참고하는 셈이고, 더 중요하게는 같은 카드를 두 번 올릴 위험을 뜻한다.
  isOwnListing: boolean;
  // 같은 카드라고 얼마나 확신하는지. exact만 시세 기준으로 쓰고 similar는
  // 사람이 눈으로 확인할 참고 후보다.
  matchTier: Exclude<PhotocardMatchTier, "rejected">;
  matchReason: string;
  // 이 후보를 어떤 방법으로 찾았는지(제목 검색 / 이미지 검색).
  foundBy: "keyword" | "image";
};

export type MarketCompsResult = {
  source: "image" | "keyword" | "both" | "none";
  // 이미지 검색까지 갔거나 결과가 비었을 때 사람이 이유를 알 수 있게 남긴다.
  fallbackReason: string | null;
  query: string | null;
  // 실제로 eBay에 보낸 검색어 전부. 결과가 이상할 때 원인을 바로 볼 수 있다.
  queries: string[];
  comps: MarketComp[];
  // eBay에서 받아 봤지만 같은 카드가 아니어서 걸러낸 개수.
  filteredOutCount: number;
  // 후보 중 내 리스팅이 섞여 있으면 이 카드는 이미 eBay에 올라가 있다는 뜻이다.
  ownListingItemIds: string[];
};

// 제목 생성이 실제로 읽는 필드와 이미지 선택에 쓰는 필드만 요구한다.
// 상품 전체를 넘기지 않아도 되도록 좁게 잡았다.
export type MarketCompsProduct = PhotocardMatchProduct & {
  ebayTitle?: string | null;
  userFrontImageUrl?: string | null;
  imageUrl?: string | null;
  ebayImageUrls?: string[];
};

const MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
// 한 번에 받아 오는 개수. 걸러내는 비율이 높으므로 넉넉히 받아야 같은 카드가 남는다.
const RESULT_LIMIT = 100;
const EXACT_DISPLAY_LIMIT = 8;
const SIMILAR_DISPLAY_LIMIT = 6;
// 확신 있는 후보가 이만큼 모이면 더 찾지 않는다. eBay 호출과 응답 시간을 아낀다.
const ENOUGH_EXACT_COUNT = 3;
// 검색어를 넓혀 가며 시도하는 최대 횟수.
const MAX_QUERY_ATTEMPTS = 3;
// 검색어에 넣을 앨범 낱말 개수. 너무 많이 넣으면 eBay가 전부 포함한 것만 찾아
// 결과가 0건이 된다.
const MAX_QUERY_ALBUM_TOKENS = 3;
// 이미지를 통째로 base64로 올리므로 큰 파일은 요청 시간과 메모리를 함께 늘린다.
const MAX_IMAGE_BYTES = 3_000_000;

type BrowseItemSummary = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  condition?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl?: string }>;
  price?: { value?: string; currency?: string };
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>;
  seller?: { username?: string };
};

type FoundItem = { item: BrowseItemSummary; foundBy: "keyword" | "image" };

// Browse API의 itemId는 "v1|123456789|0" 형태다. 가운데가 eBay 화면과 활성상품
// 보고서에서 쓰는 숫자 상품번호이므로, 내 리스팅 대조는 이 값으로 한다.
function legacyItemIdOf(item: BrowseItemSummary) {
  if (item.legacyItemId) return item.legacyItemId;
  const parts = String(item.itemId ?? "").split("|");
  return parts.length >= 2 && /^\d+$/.test(parts[1]) ? parts[1] : null;
}

function browseHeaders() {
  return {
    "x-ebay-c-marketplace-id": MARKETPLACE_ID,
  };
}

function toComp(
  found: FoundItem,
  match: PhotocardTitleMatch,
): MarketComp | null {
  const { item } = found;
  const priceUsd = Number(item.price?.value);
  if (!item.itemId || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  // USD 이외 통화는 환산 없이 섞으면 최저가 판단이 틀어지므로 제외한다.
  if (item.price?.currency && item.price.currency !== "USD") {
    return null;
  }
  if (match.tier === "rejected") {
    return null;
  }

  const shippingRaw = item.shippingOptions?.[0]?.shippingCost?.value;
  const shippingUsd = shippingRaw === undefined ? null : Number(shippingRaw);
  const shipping = shippingUsd !== null && Number.isFinite(shippingUsd) ? shippingUsd : null;

  return {
    itemId: item.itemId,
    legacyItemId: legacyItemIdOf(item),
    title: String(item.title ?? "").slice(0, 200),
    priceUsd,
    shippingUsd: shipping,
    totalUsd: Number((priceUsd + (shipping ?? 0)).toFixed(2)),
    condition: item.condition ?? null,
    imageUrl: item.thumbnailImages?.[0]?.imageUrl ?? item.image?.imageUrl ?? null,
    itemWebUrl: item.itemWebUrl ?? null,
    sellerUsername: item.seller?.username ?? null,
    isOwnListing: false,
    matchTier: match.tier,
    matchReason: match.reason,
    foundBy: found.foundBy,
  };
}

// 받아 온 후보를 같은 카드인지로 거르고, 확신이 높은 것 → 배송비 포함 싼 것
// 순서로 정렬한다. 가격만으로 정렬하면 카드가 아닌 싸구려가 맨 위를 차지한다.
function rankComps(product: MarketCompsProduct, found: FoundItem[]) {
  const comps: MarketComp[] = [];
  let filteredOutCount = 0;

  for (const entry of found) {
    const match = analyzePhotocardTitleMatch(product, String(entry.item.title ?? ""));
    const comp = match.tier === "rejected" ? null : toComp(entry, match);
    if (comp) {
      comps.push(comp);
    } else {
      filteredOutCount += 1;
    }
  }

  const byPrice = (left: MarketComp, right: MarketComp) => left.totalUsd - right.totalUsd;
  const exact = comps.filter((comp) => comp.matchTier === "exact").sort(byPrice);
  const similar = comps.filter((comp) => comp.matchTier === "similar").sort(byPrice);

  return {
    exactCount: exact.length,
    filteredOutCount,
    comps: [
      ...exact.slice(0, EXACT_DISPLAY_LIMIT),
      ...similar.slice(0, SIMILAR_DISPLAY_LIMIT),
    ],
  };
}

// 후보 중 내가 이미 올려둔 리스팅을 표시한다. 판단 근거는 두 가지다.
//  1) 최근 전체 활성상품 보고서에 같은 상품번호가 있는가 — 프로그램을 거치지 않고
//     수동으로 올린 리스팅도 보고서에는 들어 있으므로 이 대조로 잡힌다.
//  2) 판매자 계정명이 내 eBay 계정과 같은가 — 보고서가 오래됐을 때를 위한 보완.
async function markOwnListings(comps: MarketComp[]) {
  if (!comps.length) return comps;

  const legacyIds = comps
    .map((comp) => comp.legacyItemId)
    .filter((id): id is string => Boolean(id));

  const [ownListings, accounts] = await Promise.all([
    legacyIds.length
      ? prisma.ebayActiveListing.findMany({
          where: { itemId: { in: legacyIds } },
          select: { itemId: true },
        })
      : Promise.resolve([]),
    prisma.ebayAccount.findMany({ select: { username: true } }),
  ]);

  const ownItemIds = new Set(ownListings.map((listing) => listing.itemId));
  const ownUsernames = new Set(
    accounts
      .map((account) => account.username?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );

  return comps.map((comp) => ({
    ...comp,
    isOwnListing:
      (comp.legacyItemId !== null && ownItemIds.has(comp.legacyItemId)) ||
      (comp.sellerUsername !== null &&
        ownUsernames.has(comp.sellerUsername.trim().toLowerCase())),
  }));
}

// 상품에 붙은 이미지 중 카드 앞면에 가장 가까운 것을 고른다.
export function compSearchImageUrl(product: MarketCompsProduct) {
  return (
    product.userFrontImageUrl?.trim() ||
    product.ebayImageUrls?.[0]?.trim() ||
    product.imageUrl?.trim() ||
    null
  );
}

// eBay 검색어는 넣은 낱말을 모두 포함한 상품만 찾는다. 그래서 좁은 검색어부터
// 시작해 결과가 모자라면 한 단계씩 넓힌다. 등록용 제목("Official ... Kpop")을
// 그대로 쓰면 그 낱말이 없는 리스팅이 전부 빠져 0건이 되기 쉽다.
export function buildCompQueries(product: MarketCompsProduct): string[] {
  const group = groupNames(product.brand)[0] ?? "";
  const member = memberQueryName(product);
  const album = albumQueryTokens(product);
  const base = [group, member].filter(Boolean).join(" ").trim();

  const queries: string[] = [];
  if (base) {
    if (album.length) {
      queries.push(`${base} ${album.slice(0, MAX_QUERY_ALBUM_TOKENS).join(" ")}`);
      queries.push(`${base} ${album[0]}`);
    }
    queries.push(`${base} photocard`);
  } else if (album.length) {
    queries.push([group, ...album.slice(0, MAX_QUERY_ALBUM_TOKENS)].join(" ").trim());
    queries.push([group, "photocard"].filter(Boolean).join(" "));
  } else if (group) {
    queries.push(`${group} photocard`);
  }

  const fallback = String(product.ebayTitle ?? product.productName ?? "").trim();
  if (!queries.length && fallback) {
    queries.push(fallback.slice(0, 80));
  }

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(
    0,
    MAX_QUERY_ATTEMPTS,
  );
}

async function searchByImage(imageUrl: string): Promise<BrowseItemSummary[]> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`상품 이미지를 불러오지 못했습니다 (${imageResponse.status}).`);
  }

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("상품 이미지가 너무 커서 eBay 이미지 검색에 보낼 수 없습니다.");
  }

  const config = getEbayConfig();
  const url = new URL("/buy/browse/v1/item_summary/search_by_image", config.hosts.api);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

  const { body } = await ebayApplicationFetch(url, {
    method: "POST",
    headers: { ...browseHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ image: buffer.toString("base64") }),
  });

  return (body as { itemSummaries?: BrowseItemSummary[] }).itemSummaries ?? [];
}

async function searchByKeyword(
  query: string,
  sort: "price" | null,
): Promise<BrowseItemSummary[]> {
  const config = getEbayConfig();
  const url = new URL("/buy/browse/v1/item_summary/search", config.hosts.api);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");
  if (sort) {
    url.searchParams.set("sort", sort);
  }

  const { body } = await ebayApplicationFetch(url, { headers: browseHeaders() });
  return (body as { itemSummaries?: BrowseItemSummary[] }).itemSummaries ?? [];
}

// 제목 검색을 먼저 하고(무엇을 찾는지 우리가 알고 있으므로 가장 정확하다),
// 같은 카드를 못 찾았을 때만 이미지 검색으로 보완한다. 이미지 검색은 비슷한
// 그림이면 다른 카드도 가져오므로, 그 결과에도 같은 제목 판정을 그대로 건다.
export async function findMarketComps(
  product: MarketCompsProduct,
): Promise<MarketCompsResult> {
  const queries = buildCompQueries(product);
  const found = new Map<string, FoundItem>();
  const usedQueries: string[] = [];

  const collect = (items: BrowseItemSummary[], foundBy: "keyword" | "image") => {
    for (const item of items) {
      if (item.itemId && !found.has(item.itemId)) {
        found.set(item.itemId, { item, foundBy });
      }
    }
  };

  for (const query of queries) {
    usedQueries.push(query);
    // 값싼 순과 관련도 순을 함께 본다. 값싼 순만 보면 상단이 사은품·부속품으로
    // 채워져 정작 같은 카드가 받아 오는 범위 밖으로 밀려난다.
    const [byPrice, byRelevance] = await Promise.all([
      searchByKeyword(query, "price"),
      searchByKeyword(query, null),
    ]);
    collect([...byPrice, ...byRelevance], "keyword");

    if (rankComps(product, [...found.values()]).exactCount >= ENOUGH_EXACT_COUNT) {
      break;
    }
  }

  let ranked = rankComps(product, [...found.values()]);
  let fallbackReason: string | null = null;
  let usedImage = false;

  if (ranked.exactCount === 0) {
    const imageUrl = compSearchImageUrl(product);
    if (imageUrl) {
      try {
        collect(await searchByImage(imageUrl), "image");
        usedImage = true;
        ranked = rankComps(product, [...found.values()]);
        fallbackReason =
          "제목으로 같은 카드를 찾지 못해 상품 이미지로 한 번 더 찾았습니다.";
      } catch (error) {
        // 이미지 검색 실패로 조회 자체를 포기하지 않는다. 제목 결과가 남아 있다.
        fallbackReason = "이미지 검색에 실패해 제목 검색 결과만 보여 줍니다.";
        safeLog("warn", "ebay.comps.image_search_failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    } else {
      fallbackReason = "상품에 이미지가 없어 제목으로만 찾았습니다.";
    }
  }

  if (!ranked.comps.length && ranked.filteredOutCount > 0) {
    fallbackReason =
      `eBay에서 ${ranked.filteredOutCount}건을 받았지만 그룹·멤버·앨범이 맞는 카드가 없어 모두 제외했습니다.`;
  }

  const comps = await markOwnListings(ranked.comps);
  const usedKeyword = comps.some((comp) => comp.foundBy === "keyword");
  const fromImage = comps.some((comp) => comp.foundBy === "image");

  return {
    source: !comps.length
      ? "none"
      : usedKeyword && fromImage
        ? "both"
        : fromImage
          ? "image"
          : "keyword",
    fallbackReason,
    query: usedQueries[usedQueries.length - 1] ?? null,
    queries: usedImage ? [...usedQueries, "(이미지 검색)"] : usedQueries,
    comps,
    filteredOutCount: ranked.filteredOutCount,
    ownListingItemIds: ownIds(comps),
  };
}

function ownIds(comps: MarketComp[]) {
  return comps
    .filter((comp) => comp.isOwnListing)
    .map((comp) => comp.legacyItemId ?? comp.itemId);
}
