import type { Product } from "@/generated/prisma";
import { getShopifyConfig, type ShopifyConfig } from "@/lib/env";
import {
  buildEbayListingDescription,
  buildEbayListingItemSpecifics,
  buildEbayListingTitle,
  type EbayListingFieldProduct,
  type ProductImageExtras,
} from "@/lib/ebay-listing-fields";
import { safeLog } from "@/lib/safe-log";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { getShopifyAccessToken } from "@/lib/services/shopifyToken";
import { createHash } from "node:crypto";

export class ShopifyApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ShopifyApiError";
    this.status = status;
    this.details = details;
  }
}

type ShopifyRequestInput = {
  method?: string;
  path: string;
  body?: unknown;
};

export async function shopifyApiRequest(
  config: ShopifyConfig,
  input: ShopifyRequestInput,
): Promise<unknown> {
  const url = `https://${config.storeDomain}/admin/api/${config.apiVersion}${input.path}`;
  const hasBody = input.body !== undefined;
  const accessToken = await getShopifyAccessToken(config);

  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      accept: "application/json",
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    safeLog("error", "shopify.request_failed", {
      path: input.path,
      method: input.method ?? "GET",
      status: response.status,
      body,
    });
    throw new ShopifyApiError(
      "Shopify Admin API request failed.",
      response.status,
      body,
    );
  }

  return body;
}

type ShopifyGraphqlError = { field?: string[] | null; message?: string; code?: string | null };

// Shopify 상품 REST API는 레거시이며 일부 스토어에서 상품 생성 요청이 500으로
// 끝난다. GraphQL 응답의 userErrors를 숨기지 않고 호출자에게 돌려 주기 위한
// 작은 공통 경로다.
async function shopifyGraphqlRequest<T>(
  config: ShopifyConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": await getShopifyAccessToken(config),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = await response.json().catch(() => null) as { data?: T; errors?: ShopifyGraphqlError[] } | null;
  if (!response.ok || body?.errors?.length || !body?.data) {
    safeLog("error", "shopify.graphql_request_failed", {
      status: response.status,
      errors: body?.errors?.map((error) => error.message) ?? [],
    });
    throw new ShopifyApiError("Shopify GraphQL 상품 요청에 실패했습니다.", response.status || 502, body);
  }
  return body.data;
}

export type ShopifyImageSyncResult = {
  requested: number;
  attached: number;
  alreadyAttached: number;
  processing: number;
};

export type ShopifyImageReplaceResult = ShopifyImageSyncResult & {
  removed: number;
  media: Array<{ sourceUrl: string; mediaId: string }>;
};

// Shopify는 외부 URL을 "파일"로만 저장해도 상품 미디어(스토어 카드의 썸네일)
// 에 연결하지 않는다. productCreateMedia로 명시적으로 연결해야 한다.
// alt에 원본 URL의 해시를 기록해, 보정 작업을 재시작해도 같은 사진을 중복으로
// 추가하지 않는다.
function shopifyImageMarker(url: string) {
  return `managed-source:${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

export async function syncShopifyProductImages(
  config: ShopifyConfig,
  productId: string,
  sourceUrls: string[],
): Promise<ShopifyImageSyncResult> {
  const urls = [...new Set(sourceUrls.map((url) => url.trim()).filter(Boolean))];
  if (!urls.length) return { requested: 0, attached: 0, alreadyAttached: 0, processing: 0 };

  const query = `query ProductMedia($id: ID!) {
    product(id: $id) { media(first: 250) { nodes { alt } } }
  }`;
  const existing = await shopifyGraphqlRequest<{
    product?: { media?: { nodes?: Array<{ alt?: string | null }> } | null } | null;
  }>(config, query, { id: `gid://shopify/Product/${productId}` });
  const existingMarkers = new Set(
    (existing.product?.media?.nodes ?? []).flatMap((media) => media.alt?.startsWith("managed-source:") ? [media.alt] : []),
  );
  const missing = urls.filter((url) => !existingMarkers.has(shopifyImageMarker(url)));
  if (!missing.length) return { requested: urls.length, attached: 0, alreadyAttached: urls.length, processing: 0 };

  const mutation = `mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { alt status mediaContentType }
      mediaUserErrors { field message }
    }
  }`;
  const created = await shopifyGraphqlRequest<{
    productCreateMedia?: {
      media?: Array<{ alt?: string | null; status?: string | null }> | null;
      mediaUserErrors?: ShopifyGraphqlError[];
    };
  }>(config, mutation, {
    productId: `gid://shopify/Product/${productId}`,
    media: missing.map((originalSource) => ({
      alt: shopifyImageMarker(originalSource),
      mediaContentType: "IMAGE",
      originalSource,
    })),
  });
  const errors = graphqlUserErrorMessage(created.productCreateMedia?.mediaUserErrors);
  if (errors) throw new ShopifyApiError(errors, 422, created);
  const media = created.productCreateMedia?.media ?? [];
  if (media.length !== missing.length) {
    throw new ShopifyApiError("Shopify가 모든 상품 이미지를 접수하지 않았습니다.", 502, created);
  }
  return {
    requested: urls.length,
    attached: media.length,
    alreadyAttached: urls.length - missing.length,
    processing: media.filter((item) => item.status !== "READY").length,
  };
}

/**
 * 현재 관리 시스템의 최종 승인 사진으로 Shopify 상품 사진을 교체한다.
 * 먼저 새 사진을 Shopify가 접수한 뒤에만 이전 IMAGE 미디어를 지우므로, 업로드
 * 실패 때문에 사진이 전혀 없는 상품이 되는 일을 막는다. 동영상·3D 미디어는
 * 건드리지 않는다.
 */
export async function replaceShopifyProductImages(
  config: ShopifyConfig,
  productId: string,
  sourceUrls: string[],
): Promise<ShopifyImageReplaceResult> {
  const synced = await syncShopifyProductImages(config, productId, sourceUrls);
  const urls = [...new Set(sourceUrls.map((url) => url.trim()).filter(Boolean))];
  const wantedMarkers = new Set(
    urls.map(shopifyImageMarker),
  );
  const query = `query ProductMediaForReplacement($id: ID!) {
    product(id: $id) { media(first: 250) { nodes { id alt mediaContentType status } } }
  }`;
  type ProductMediaResponse = {
    product?: { media?: { nodes?: Array<{ id: string; alt?: string | null; mediaContentType?: string | null; status?: string | null }> } | null } | null;
  };
  let current: ProductMediaResponse | null = null;
  let mediaByMarker = new Map<string, { id: string; alt?: string | null; mediaContentType?: string | null; status?: string | null }>();
  let requestedMedia: Array<{ sourceUrl: string; media: { id: string; alt?: string | null; mediaContentType?: string | null; status?: string | null } | undefined }> = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    current = await shopifyGraphqlRequest<ProductMediaResponse>(config, query, { id: `gid://shopify/Product/${productId}` });
    mediaByMarker = new Map(
      (current.product?.media?.nodes ?? [])
        .filter((media) => media.mediaContentType === "IMAGE" && media.alt?.startsWith("managed-source:"))
        .map((media) => [media.alt!, media] as const),
    );
    requestedMedia = urls.map((url) => ({ sourceUrl: url, media: mediaByMarker.get(shopifyImageMarker(url)) }));
    const failed = requestedMedia.find((entry) => entry.media?.status === "FAILED");
    if (failed) throw new ShopifyApiError("Shopify가 이미지를 처리하지 못했습니다. 원본 URL과 이미지 형식을 확인해 주세요.", 422, failed);
    if (!requestedMedia.some((entry) => !entry.media || entry.media.status !== "READY")) break;
    if (attempt === 9) throw new ShopifyApiError("Shopify 이미지 처리 시간이 초과되었습니다. 기존 사진은 유지했습니다. 잠시 후 다시 실행해 주세요.", 409, requestedMedia);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const staleImageIds = (current?.product?.media?.nodes ?? [])
    .filter((media) => media.mediaContentType === "IMAGE" && !wantedMarkers.has(media.alt ?? ""))
    .map((media) => media.id);
  const media = requestedMedia.map((entry) => ({ sourceUrl: entry.sourceUrl, mediaId: entry.media!.id }));
  if (!staleImageIds.length) return { ...synced, removed: 0, media };

  const mutation = `mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
  }`;
  const deleted = await shopifyGraphqlRequest<{
    productDeleteMedia?: { deletedMediaIds?: string[] | null; mediaUserErrors?: ShopifyGraphqlError[] };
  }>(config, mutation, {
    productId: `gid://shopify/Product/${productId}`,
    mediaIds: staleImageIds,
  });
  const errors = graphqlUserErrorMessage(deleted.productDeleteMedia?.mediaUserErrors);
  if (errors) throw new ShopifyApiError(errors, 422, deleted);
  const removed = deleted.productDeleteMedia?.deletedMediaIds?.length ?? 0;
  if (removed !== staleImageIds.length) {
    throw new ShopifyApiError("Shopify가 기존 사진을 모두 삭제했다고 확인하지 못했습니다.", 502, deleted);
  }
  return { ...synced, removed, media };
}

/** 연결된 묶음상품의 각 옵션이 자기 카드 사진만 표시하도록 Shopify variant media를 연결한다. */
export async function attachShopifyVariantImages(
  config: ShopifyConfig,
  productId: string,
  assignments: Array<{ variantId: string; sourceUrl: string; mediaId: string }>,
) {
  if (!assignments.length) return 0;
  const mutation = `mutation ProductVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      product { id }
      userErrors { field message }
    }
  }`;
  const data = await shopifyGraphqlRequest<{
    productVariantAppendMedia?: { userErrors?: ShopifyGraphqlError[] };
  }>(config, mutation, {
    productId: `gid://shopify/Product/${productId}`,
    variantMedia: assignments.map((assignment) => ({
      variantId: `gid://shopify/ProductVariant/${assignment.variantId}`,
      mediaIds: [assignment.mediaId],
    })),
  });
  const errors = graphqlUserErrorMessage(data.productVariantAppendMedia?.userErrors);
  if (errors) throw new ShopifyApiError(errors, 422, data);
  const verification = await shopifyGraphqlRequest<{
    product?: { variants?: { nodes?: Array<{ id: string; media?: { nodes?: Array<{ id: string }> } | null }> } | null } | null;
  }>(config, `query VerifyVariantMedia($id: ID!) {
    product(id: $id) { variants(first: 250) { nodes { id media(first: 250) { nodes { id } } } }
  }`, { id: `gid://shopify/Product/${productId}` });
  const mediaIdsByVariant = new Map(
    (verification.product?.variants?.nodes ?? []).map((variant) => [variant.id, new Set((variant.media?.nodes ?? []).map((media) => media.id))]),
  );
  const missing = assignments.find((assignment) => !mediaIdsByVariant.get(`gid://shopify/ProductVariant/${assignment.variantId}`)?.has(assignment.mediaId));
  if (missing) throw new ShopifyApiError("Shopify가 옵션별 사진 연결을 확인해 주지 않았습니다.", 502, missing);
  return assignments.length;
}

/** Shopify 상품 카드가 사용하는 첫 번째 미디어를 제작된 묶음 썸네일로 고정한다. */
export async function moveShopifyProductMediaToFirst(
  config: ShopifyConfig,
  productId: string,
  mediaId: string,
) {
  const mutation = `mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job { id }
      mediaUserErrors { field message }
    }
  }`;
  const result = await shopifyGraphqlRequest<{
    productReorderMedia?: { job?: { id: string } | null; mediaUserErrors?: ShopifyGraphqlError[] };
  }>(config, mutation, {
    id: `gid://shopify/Product/${productId}`,
    moves: [{ id: mediaId, newPosition: "0" }],
  });
  const errors = graphqlUserErrorMessage(result.productReorderMedia?.mediaUserErrors);
  if (errors || !result.productReorderMedia?.job?.id) throw new ShopifyApiError(errors || "Shopify가 미디어 순서 변경 작업을 시작하지 못했습니다.", 422, result);

  const query = `query VerifyProductMediaOrder($id: ID!) {
    product(id: $id) { media(first: 1) { nodes { id } } }
  }`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const check = await shopifyGraphqlRequest<{ product?: { media?: { nodes?: Array<{ id: string }> } | null } | null }>(config, query, { id: `gid://shopify/Product/${productId}` });
    if (check.product?.media?.nodes?.[0]?.id === mediaId) return;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new ShopifyApiError("Shopify가 제작 썸네일을 대표 이미지(첫 번째 사진)로 반영하지 않았습니다.", 502, result);
}

function gidNumber(value: string) {
  return value.split("/").at(-1) ?? value;
}

function graphqlUserErrorMessage(errors: ShopifyGraphqlError[] | undefined) {
  return (errors ?? []).map((error) => error.message).filter((message): message is string => Boolean(message)).join(" / ");
}

function collectImageUrls(product: Product): string[] {
  const urls = [
    ...(product.ebayImageUrls ?? []),
    product.imageUrl ?? "",
  ].filter((url): url is string => typeof url === "string" && url.trim() !== "");

  return Array.from(new Set(urls));
}

let cachedLocationId: { domain: string; id: string } | null = null;

export async function resolvePrimaryLocationId(
  config: ShopifyConfig,
): Promise<string | null> {
  if (config.locationId) {
    return config.locationId;
  }
  if (cachedLocationId && cachedLocationId.domain === config.storeDomain) {
    return cachedLocationId.id;
  }

  const result = (await shopifyApiRequest(config, {
    path: "/locations.json",
  })) as { locations?: Array<{ id: number; active?: boolean }> } | null;

  const location =
    result?.locations?.find((loc) => loc.active) ?? result?.locations?.[0];
  if (!location) {
    return null;
  }

  const id = String(location.id);
  cachedLocationId = { domain: config.storeDomain, id };
  return id;
}

type ShopifyProductResponse = {
  product?: {
    id: number;
    status?: string;
    variants?: Array<{ id: number; inventory_item_id?: number; sku?: string }>;
  };
};

type ShopifyGraphqlProduct = {
  id: string;
  status?: string | null;
  variants?: { nodes?: Array<{ id: string; sku?: string | null; inventoryItem?: { id: string } | null }> };
};

async function createVariationProductWithGraphql(
  config: ShopifyConfig,
  title: string,
  items: ShopifyVariationUploadInput[],
): Promise<ShopifyProductResponse> {
  const query = `mutation ProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id status
        variants(first: 100) { nodes { id sku inventoryItem { id } } }
      }
      userErrors { field message code }
    }
  }`;
  const data = await shopifyGraphqlRequest<{
    productSet?: { product?: ShopifyGraphqlProduct | null; userErrors?: ShopifyGraphqlError[] };
  }>(config, query, {
    synchronous: true,
    input: {
      title,
      productType: "Photocard",
      tags: ["Kpop", "Photocard"],
      status: "ACTIVE",
      productOptions: [{ name: "Card", position: 1, values: items.map((item) => ({ name: item.optionName })) }],
      variants: items.map((item) => ({
        sku: item.sku,
        price: item.priceUsd,
        optionValues: [{ optionName: "Card", name: item.optionName }],
        inventoryItem: { sku: item.sku, tracked: true, requiresShipping: true },
      })),
    },
  });
  const payload = data.productSet;
  const userErrors = graphqlUserErrorMessage(payload?.userErrors);
  if (userErrors || !payload?.product) {
    throw new ShopifyApiError(userErrors || "Shopify가 GraphQL 상품 ID를 반환하지 않았습니다.", 422, data);
  }
  return {
    product: {
      id: Number(gidNumber(payload.product.id)),
      status: payload.product.status ?? undefined,
      variants: (payload.product.variants?.nodes ?? []).map((variant) => ({
        id: Number(gidNumber(variant.id)),
        sku: variant.sku ?? undefined,
        inventory_item_id: variant.inventoryItem ? Number(gidNumber(variant.inventoryItem.id)) : undefined,
      })),
    },
  };
}

async function createSingleProductWithGraphql(
  config: ShopifyConfig,
  input: { title: string; descriptionHtml: string; vendor: string | null; tags: string[]; sku: string; price: string },
): Promise<ShopifyProductResponse> {
  const query = `mutation ProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product { id status variants(first: 10) { nodes { id sku inventoryItem { id } } } }
      userErrors { field message code }
    }
  }`;
  const data = await shopifyGraphqlRequest<{
    productSet?: { product?: ShopifyGraphqlProduct | null; userErrors?: ShopifyGraphqlError[] };
  }>(config, query, {
    synchronous: true,
    input: {
      title: input.title,
      descriptionHtml: input.descriptionHtml || undefined,
      vendor: input.vendor || undefined,
      productType: "Photocard",
      tags: input.tags,
      status: "ACTIVE",
      // Shopify의 단일 기본 옵션 이름을 사용해 구매 화면에 불필요한 선택지를
      // 만들지 않으면서 SKU·가격·재고 추적이 가능한 변형을 한 개 만든다.
      productOptions: [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }],
      variants: [{
        sku: input.sku,
        price: input.price,
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        inventoryItem: { sku: input.sku, tracked: true, requiresShipping: true },
      }],
    },
  });
  const payload = data.productSet;
  const userErrors = graphqlUserErrorMessage(payload?.userErrors);
  if (userErrors || !payload?.product) {
    throw new ShopifyApiError(userErrors || "Shopify가 GraphQL 상품 ID를 반환하지 않았습니다.", 422, data);
  }
  return {
    product: {
      id: Number(gidNumber(payload.product.id)),
      status: payload.product.status ?? undefined,
      variants: (payload.product.variants?.nodes ?? []).map((variant) => ({
        id: Number(gidNumber(variant.id)),
        sku: variant.sku ?? undefined,
        inventory_item_id: variant.inventoryItem ? Number(gidNumber(variant.inventoryItem.id)) : undefined,
      })),
    },
  };
}

export type ShopifyUploadResult = {
  productId: string;
  variantId: string | null;
  inventoryItemId: string | null;
  status: string | null;
  action: "created" | "updated";
  inventorySynced: boolean;
  inventoryError: string | null;
  imageSync: ShopifyImageSyncResult | null;
  imageError: string | null;
};

export type ShopifyVariationUploadInput = {
  sku: string;
  optionName: string;
  priceUsd: string;
  quantity: number;
  imageUrls: string[];
  variantId?: string | null;
};

export type ShopifyVariationUploadResult = {
  productId: string;
  status: string | null;
  imageSync: ShopifyImageSyncResult | null;
  imageError: string | null;
  variants: Array<{
    sku: string;
    variantId: string;
    inventoryItemId: string | null;
    inventorySynced: boolean;
    inventoryError: string | null;
  }>;
};

/** 한 묶음을 Shopify 상품 하나와 여러 옵션으로 만든다. */
export async function upsertShopifyVariationProduct(
  title: string,
  items: ShopifyVariationUploadInput[],
  existingProductId?: string | null,
): Promise<ShopifyVariationUploadResult> {
  if (items.length < 2) throw new Error("Shopify 묶음상품은 옵션이 두 개 이상이어야 합니다.");
  const config = getShopifyConfig();
  const images = [...new Set(items.flatMap((item) => item.imageUrls))];
  let response: ShopifyProductResponse;
  let usedGraphqlFallback = false;
  try {
    response = await shopifyApiRequest(config, {
      method: existingProductId ? "PUT" : "POST",
      path: existingProductId ? `/products/${existingProductId}.json` : "/products.json",
      body: {
        product: {
          title,
          product_type: "Photocard",
          tags: "Kpop, Photocard",
          status: "active",
          options: [{ name: "Card" }],
          variants: items.map((item) => ({
            ...(item.variantId ? { id: Number(item.variantId) } : {}),
            sku: item.sku,
            option1: item.optionName,
            price: item.priceUsd,
            inventory_management: "shopify",
          })),
          ...(!existingProductId && images.length ? { images: images.map((src) => ({ src })) } : {}),
        },
      },
    }) as ShopifyProductResponse;
  } catch (error) {
    // 신규 묶음 생성에서만 GraphQL로 대체한다. 기존에 연결된 상품을 REST 오류
    // 만으로 새로 만들면 중복·분리된 옵션이 생길 수 있다.
    if (!existingProductId && error instanceof ShopifyApiError && error.status >= 500) {
      response = await createVariationProductWithGraphql(config, title, items);
      usedGraphqlFallback = true;
    } else {
      throw error;
    }
  }
  const created = response.product;
  if (!created?.id) throw new ShopifyApiError("Shopify가 묶음 상품 ID를 반환하지 않았습니다.", 502, response);
  const bySku = new Map((created.variants ?? []).flatMap((variant) => variant.sku ? [[variant.sku, variant] as const] : []));
  const variants: ShopifyVariationUploadResult["variants"] = [];
  for (const item of items) {
    const variant = bySku.get(item.sku);
    if (!variant) throw new ShopifyApiError(`Shopify가 ${item.sku} 옵션 ID를 반환하지 않았습니다.`, 502, response);
    const inventoryItemId = variant.inventory_item_id ? String(variant.inventory_item_id) : null;
    let inventorySynced = false;
    let inventoryError: string | null = null;
    if (inventoryItemId) {
      try {
        await setShopifyInventoryLevel(config, inventoryItemId, item.quantity);
        inventorySynced = true;
      } catch (error) {
        // 상품/옵션 생성은 이미 성공했을 수 있다. 여기서 전체 작업을 throw하면
        // 그 외부 ID를 저장하지 못해 다음 실행 때 같은 묶음을 또 만들 수 있다.
        inventoryError = error instanceof Error ? error.message : String(error);
      }
    } else {
      inventoryError = "Shopify가 옵션 재고 항목 ID를 반환하지 않았습니다.";
    }
    variants.push({
      sku: item.sku,
      variantId: String(variant.id),
      inventoryItemId,
      inventorySynced,
      inventoryError,
    });
  }
  const productId = String(created.id);
  let imageSync: ShopifyImageSyncResult | null = null;
  let imageError: string | null = null;
  if (usedGraphqlFallback) {
    try {
      imageSync = await syncShopifyProductImages(config, productId, images);
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
    }
  }
  await setShopifyProductCategory(config, productId, PHOTOCARD_TAXONOMY_CATEGORY);
  return { productId, status: created.status ?? null, variants, imageSync, imageError };
}

/**
 * Push a single product to Shopify via the Admin REST API.
 *
 * Creates a new product, or updates the existing one when the product already
 * carries a `shopifyProductId`. Inventory quantity is synced to the resolved
 * store location so the same physical stock drives both eBay and Shopify.
 */
// Shopify standard taxonomy category for K-pop photocards:
// Arts & Entertainment > … > Collectible Trading Cards > Non-Sports Trading Cards.
const PHOTOCARD_TAXONOMY_CATEGORY = "gid://shopify/TaxonomyCategory/ae-2-2-3-3";

function escapeHtmlText(value: string) {
  return value.replace(/[<>&]/g, (char) =>
    char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&amp;",
  );
}

// Shopify (unlike eBay) does not auto-render item specifics, so we fold them into
// the product description as a details list — that's what makes the Shopify
// product page informative like the eBay item page.
export function buildShopifyBodyHtml(
  listingProduct: EbayListingFieldProduct,
  specifics: Record<string, string>,
): string {
  const base = buildEbayListingDescription(listingProduct).trim();
  const detailRows = (
    [
      ["Group", specifics.Brand],
      ["Member", specifics["Featured Person/Artist"]],
      ["Album / Set", specifics.Set],
      ["Type", "Official Photocard"],
      ["Genre", specifics.Genre],
      ["Country/Region", specifics["Country/Region of Manufacture"]],
      ["Condition", "Brand New (Official)"],
    ] as Array<[string, string]>
  ).filter(([, value]) => Boolean(value && value.trim()));

  const detailList = detailRows
    .map(
      ([label, value]) =>
        `<li><strong>${escapeHtmlText(label)}:</strong> ${escapeHtmlText(value)}</li>`,
    )
    .join("");

  // `base` may be raw HTML (descriptionHtml) or plain text (memo / fallback).
  const looksHtml = /<[a-z][\s\S]*>/i.test(base);
  const intro = base ? (looksHtml ? base : `<p>${escapeHtmlText(base)}</p>`) : "";

  return `${intro}<h3>Product Details</h3><ul>${detailList}</ul>`.trim();
}

// Sets the Shopify standard product category via GraphQL (REST can't write it).
// Best-effort: never throws, so a category hiccup can't fail the whole upload.
async function setShopifyProductCategory(
  config: ShopifyConfig,
  productId: string,
  categoryGid: string,
): Promise<void> {
  try {
    const query = `mutation setCategory($id: ID!, $category: ID!) {
      productUpdate(input: { id: $id, category: $category }) {
        userErrors { field message }
      }
    }`;
    const response = await fetch(
      `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": await getShopifyAccessToken(config),
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: {
            id: `gid://shopify/Product/${productId}`,
            category: categoryGid,
          },
        }),
      },
    );
    if (!response.ok) {
      safeLog("warn", "shopify.category_set_failed", {
        productId,
        status: response.status,
      });
    }
  } catch (error) {
    safeLog("warn", "shopify.category_set_error", {
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 한 카드의 Shopify 판매 가능 수량을 정한다.
 *
 * 상품 등록 때만이 아니라 재고가 바뀔 때마다 불러야 같은 카드가 두 채널에서
 * 동시에 팔리지 않는다.
 */
export async function setShopifyInventoryLevel(
  config: ShopifyConfig,
  inventoryItemId: string,
  available: number,
) {
  const locationId = config.locationId ?? (await resolvePrimaryLocationId(config));
  if (!locationId) {
    throw new Error("Shopify 재고 위치를 찾지 못했습니다.");
  }
  await shopifyApiRequest(config, {
    method: "POST",
    path: "/inventory_levels/set.json",
    body: {
      location_id: Number(locationId),
      inventory_item_id: Number(inventoryItemId),
      available: Math.max(0, Math.trunc(available)),
    },
  });
}

export async function uploadProductToShopify(
  product: Product,
  extras?: ProductImageExtras,
  // 아직 처리하지 않은 주문이 잡아 둔 수량. 주면 그만큼 빼고 올린다.
  reservedQuantity?: number,
  priceOverrideUsd?: string,
): Promise<ShopifyUploadResult> {
  // salePrice는 포카마켓 원화 가격이다. 이 함수가 USD 가격을 못 받았을 때
  // salePrice를 대신 보내면 12,000원이 USD 12,000로 등록되는 치명적인 오류가 난다.
  const price = priceOverrideUsd?.trim();
  if (!price || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    throw new Error("Shopify 등록/수정에는 검증된 USD 판매가가 필요합니다.");
  }

  // 외부 상품을 만든 뒤에 공급처 미확인을 발견하면 이미 되돌리기 어려운 반쪽
  // 등록이 된다. API 호출 전에 재고 출처와 수량을 확정한다.
  const availability = resolveChannelAvailability({
    status: product.status,
    stockQuantity: product.stockQuantity,
    reservedQuantity: reservedQuantity ?? 0,
    isSoldOut: product.isSoldOut,
    pocamarketAvailableCount: product.pocamarketAvailableCount,
    pocamarketSyncedAt: product.pocamarketSyncedAt,
  });
  if (!availability.actionable) {
    throw new Error("포카마켓 재고가 확인되지 않아 Shopify 등록/수정을 시작하지 않습니다.");
  }

  const config = getShopifyConfig();

  // Build title/description/specifics with the SAME logic as the eBay listing so
  // Shopify matches eBay: formatted "Group Member Official Album Photocard Kpop"
  // title, generated description, and K-Pop/Photocard/album tags.
  const listingProduct = { ...product, ...extras } as EbayListingFieldProduct;
  const title = buildEbayListingTitle(listingProduct);
  const specifics = buildEbayListingItemSpecifics(listingProduct);
  const bodyHtml = buildShopifyBodyHtml(listingProduct, specifics);
  const tags = Array.from(
    new Set(
      [
        specifics.Brand,
        specifics["Featured Person/Artist"],
        specifics.Set,
        specifics.Genre,
        "Photocard",
      ]
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
  const images = collectImageUrls(product);

  const variant: Record<string, unknown> = {
    sku: product.sku,
    inventory_management: "shopify",
  };
  variant.price = price;

  const isUpdate = Boolean(product.shopifyProductId);

  const productPayload: Record<string, unknown> = {
    title,
    body_html: bodyHtml || undefined,
    vendor: product.brand ?? undefined,
    product_type: "Photocard",
    tags: tags.join(", "),
    status: "active",
  };

  // Create payload: fresh variant + images.
  const createPayload: Record<string, unknown> = {
    ...productPayload,
    variants: [{ ...variant }],
    ...(images.length ? { images: images.map((src) => ({ src })) } : {}),
  };

  async function createProduct() {
    try {
      return { response: (await shopifyApiRequest(config, {
        method: "POST",
        path: "/products.json",
        body: { product: createPayload },
      })) as ShopifyProductResponse, usedGraphqlFallback: false };
    } catch (error) {
      if (error instanceof ShopifyApiError && error.status >= 500) {
        return { response: await createSingleProductWithGraphql(config, {
          title,
          descriptionHtml: bodyHtml,
          vendor: product.brand,
          tags,
          sku: product.sku,
          price: price!,
        }), usedGraphqlFallback: true };
      }
      throw error;
    }
  }

  let response: ShopifyProductResponse;
  let action: "created" | "updated";
  let usedGraphqlFallback = false;

  if (isUpdate) {
    // Update in place; keep the existing variant id so we don't duplicate it.
    // Images aren't re-sent on update (would append duplicates).
    const updatePayload: Record<string, unknown> = {
      ...productPayload,
      variants: [
        product.shopifyVariantId
          ? { ...variant, id: Number(product.shopifyVariantId) }
          : { ...variant },
      ],
    };
    try {
      response = (await shopifyApiRequest(config, {
        method: "PUT",
        path: `/products/${product.shopifyProductId}.json`,
        body: { product: updatePayload },
      })) as ShopifyProductResponse;
      action = "updated";
    } catch (error) {
      // 연결된 Shopify 상품이 없어졌다고 즉시 새 상품을 만들면, 사람이 의도해
      // 삭제한 상품을 중복으로 되살릴 수 있다. 운영자가 목록에서 확인해 신규
      // 등록으로 보낼 때만 다시 만들도록 막는다.
      if (error instanceof ShopifyApiError && error.status === 404) {
        throw new Error("연결된 Shopify 상품을 찾지 못했습니다. 중복 등록을 막기 위해 자동 재생성하지 않습니다. 채널 운영 메뉴에서 연결 상태를 확인해 주세요.");
      } else {
        throw error;
      }
    }
  } else {
    const createResult = await createProduct();
    response = createResult.response;
    usedGraphqlFallback = createResult.usedGraphqlFallback;
    action = "created";
  }

  const created = response.product;
  if (!created?.id) {
    throw new ShopifyApiError(
      "Shopify가 상품 ID를 반환하지 않았습니다.",
      502,
      response,
    );
  }

  const productId = String(created.id);

  let imageSync: ShopifyImageSyncResult | null = null;
  let imageError: string | null = null;
  if (usedGraphqlFallback) {
    try {
      imageSync = await syncShopifyProductImages(config, productId, images);
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
    }
  }

  // Set the standard product category (GraphQL-only). Best-effort, non-fatal.
  await setShopifyProductCategory(config, productId, PHOTOCARD_TAXONOMY_CATEGORY);

  const firstVariant = created.variants?.[0];
  const variantId = firstVariant ? String(firstVariant.id) : null;
  const inventoryItemId = firstVariant?.inventory_item_id
    ? String(firstVariant.inventory_item_id)
    : product.shopifyInventoryItemId ?? null;

  let inventorySynced = false;
  let inventoryError: string | null = null;
  if (inventoryItemId) {
    // 실재고가 아니라 판매 가능 수량을 올린다. 아직 처리하지 않은 주문이 잡아 둔
    // 몫까지 팔면 이미 나간 카드를 또 팔게 된다.
    try {
      await setShopifyInventoryLevel(
        config,
        inventoryItemId,
        availability.quantity,
      );
      inventorySynced = true;
    } catch (error) {
      // 재고 위치를 못 찾는 등으로 실패해도 상품 등록 자체는 살린다.
      inventorySynced = false;
      inventoryError = error instanceof Error ? error.message : String(error);
    }
  } else {
    inventoryError = "Shopify가 재고 항목 ID를 반환하지 않았습니다.";
  }

  return {
    productId,
    variantId,
    inventoryItemId,
    status: created.status ?? null,
    action,
    inventorySynced,
    inventoryError,
    imageSync,
    imageError,
  };
}
