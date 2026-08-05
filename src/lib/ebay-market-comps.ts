import "server-only";

import { buildEbayListingTitle } from "@/lib/ebay-listing-fields";
import { ebayApplicationFetch } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { safeLog } from "@/lib/safe-log";

// eBay에 실제로 올라와 있는 같은 카드의 판매가를 찾아 "가격 참고 후보"를 만든다.
// 사람이 구글 렌즈로 하던 일을 eBay Browse API로 대신하는 것이며, 여기서 정해진
// 가격을 상품에 자동 반영하지 않는다. 채택은 화면에서 사람이 한다
// (docs/business-rules.md 가격 계산: 계산만으로 eBay 가격을 바꾸지 않는다).

export type MarketComp = {
  itemId: string;
  title: string;
  priceUsd: number;
  shippingUsd: number | null;
  // 배송비까지 더한 구매자 실제 부담액. 최저가 비교는 이 값으로 해야 공정하다.
  totalUsd: number;
  condition: string | null;
  imageUrl: string | null;
  itemWebUrl: string | null;
};

export type MarketCompsResult = {
  source: "image" | "keyword";
  // 이미지 검색이 실패해 제목 검색으로 넘어갔을 때 사람이 알 수 있게 남긴다.
  fallbackReason: string | null;
  query: string | null;
  comps: MarketComp[];
};

// 제목 생성이 실제로 읽는 필드와 이미지 선택에 쓰는 필드만 요구한다.
// 상품 전체를 넘기지 않아도 되도록 좁게 잡았다.
export type MarketCompsProduct = {
  brand?: string | null;
  category?: string | null;
  optionName?: string | null;
  productName?: string | null;
  ebayTitle?: string | null;
  featuredMembers?: string | null;
  userFrontImageUrl?: string | null;
  imageUrl?: string | null;
  ebayImageUrls?: string[];
};

const MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
const RESULT_LIMIT = 10;
// 이미지를 통째로 base64로 올리므로 큰 파일은 요청 시간과 메모리를 함께 늘린다.
const MAX_IMAGE_BYTES = 3_000_000;

type BrowseItemSummary = {
  itemId?: string;
  title?: string;
  condition?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl?: string }>;
  price?: { value?: string; currency?: string };
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>;
};

function browseHeaders() {
  return {
    "x-ebay-c-marketplace-id": MARKETPLACE_ID,
  };
}

function toComp(item: BrowseItemSummary): MarketComp | null {
  const priceUsd = Number(item.price?.value);
  if (!item.itemId || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  // USD 이외 통화는 환산 없이 섞으면 최저가 판단이 틀어지므로 제외한다.
  if (item.price?.currency && item.price.currency !== "USD") {
    return null;
  }

  const shippingRaw = item.shippingOptions?.[0]?.shippingCost?.value;
  const shippingUsd = shippingRaw === undefined ? null : Number(shippingRaw);
  const shipping = shippingUsd !== null && Number.isFinite(shippingUsd) ? shippingUsd : null;

  return {
    itemId: item.itemId,
    title: String(item.title ?? "").slice(0, 200),
    priceUsd,
    shippingUsd: shipping,
    totalUsd: Number((priceUsd + (shipping ?? 0)).toFixed(2)),
    condition: item.condition ?? null,
    imageUrl: item.thumbnailImages?.[0]?.imageUrl ?? item.image?.imageUrl ?? null,
    itemWebUrl: item.itemWebUrl ?? null,
  };
}

function toComps(items: BrowseItemSummary[] | undefined) {
  return (items ?? [])
    .map(toComp)
    .filter((comp): comp is MarketComp => comp !== null)
    .sort((left, right) => left.totalUsd - right.totalUsd);
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

async function searchByKeyword(query: string): Promise<BrowseItemSummary[]> {
  const config = getEbayConfig();
  const url = new URL("/buy/browse/v1/item_summary/search", config.hosts.api);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");
  url.searchParams.set("sort", "price");

  const { body } = await ebayApplicationFetch(url, { headers: browseHeaders() });
  return (body as { itemSummaries?: BrowseItemSummary[] }).itemSummaries ?? [];
}

// 이미지 검색을 먼저 시도하고, 이미지가 없거나 결과가 비면 제목 검색으로 넘어간다.
export async function findMarketComps(
  product: MarketCompsProduct,
): Promise<MarketCompsResult> {
  const imageUrl = compSearchImageUrl(product);
  let fallbackReason: string | null = null;

  if (imageUrl) {
    try {
      const comps = toComps(await searchByImage(imageUrl));
      if (comps.length) {
        return { source: "image", fallbackReason: null, query: null, comps };
      }
      fallbackReason = "이미지 검색 결과가 없어 제목으로 다시 찾았습니다.";
    } catch (error) {
      // 이미지 검색 실패로 조회 자체를 포기하지 않는다. 제목 검색이 남아 있다.
      fallbackReason = "이미지 검색에 실패해 제목으로 찾았습니다.";
      safeLog("warn", "ebay.comps.image_search_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  } else {
    fallbackReason = "상품에 이미지가 없어 제목으로 찾았습니다.";
  }

  // 제목 생성기는 상품 전체 타입을 받지만 위 필드만 읽는다(ebay-listing-fields.ts:193).
  const query = buildEbayListingTitle(
    product as Parameters<typeof buildEbayListingTitle>[0],
  )
    .slice(0, 80)
    .trim();
  if (!query) {
    return { source: "keyword", fallbackReason, query: null, comps: [] };
  }

  return {
    source: "keyword",
    fallbackReason,
    query,
    comps: toComps(await searchByKeyword(query)),
  };
}
