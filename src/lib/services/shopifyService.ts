import { refreshProcurementGroup, refreshProcurementProduct } from "@/lib/procurement-refresh";
import { withVerifiedProcurementEvidence } from "@/lib/procurement-evidence";
import type { Product } from "@/generated/prisma";
import { cardMembers, variationMembersDescription } from "@/lib/unit-card-label";
import { getShopifyConfig, type ShopifyConfig } from "@/lib/env";
import {
  buildEbayListingDescription,
  buildEbayListingItemSpecifics,
  buildEbayListingTitle,
  buildEbayVariationListingTitle,
  type EbayListingFieldProduct,
  type ProductImageExtras,
} from "@/lib/ebay-listing-fields";
import { safeLog } from "@/lib/safe-log";
import { shopifyAdminProductUrl } from "@/lib/channel-product-links";
import { prisma } from "@/lib/prisma";
import { onlineStorePublication, publishOnlineStore } from "@/lib/shopify-publication";
import { assertShopifyGallery, shopifyImageIdentity } from "@/lib/shopify-gallery";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import { listingAlbumContext } from "@/lib/listing-title-context";
import { holdShopifyVariantForMissingPrice, setShopifyPriceHoldFlag } from "@/lib/shopify-price-hold";
import type { VariationListingGroup } from "@/lib/variation-listing-groups";
import { prepareProductChannelImages, prepareProductListingSource } from "@/lib/listing-source-images";

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

const SHOPIFY_REQUEST_TIMEOUT_MS = 20_000;

let cachedAccessToken: {
  storeDomain: string;
  value: string;
  expiresAt: number;
} | null = null;
let pendingAccessToken: Promise<string> | null = null;

async function getShopifyAccessToken(config: ShopifyConfig): Promise<string> {
  if (config.accessToken) {
    return config.accessToken;
  }
  if (
    cachedAccessToken?.storeDomain === config.storeDomain &&
    cachedAccessToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedAccessToken.value;
  }
  if (pendingAccessToken) {
    return pendingAccessToken;
  }
  if (!config.clientId || !config.clientSecret) {
    throw new ShopifyApiError("Shopify 서버 인증정보가 없습니다.", 500, null);
  }

  pendingAccessToken = (async () => {
    let response: Response;
    try {
      response = await fetch(
        `https://${config.storeDomain}/admin/oauth/access_token`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "client_credentials",
          }),
          signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ShopifyApiError(
        "Shopify 서버 인증에 연결하지 못했습니다.",
        502,
        null,
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!response.ok || !payload?.access_token) {
      throw new ShopifyApiError("Shopify 서버 인증에 실패했습니다.", 502, null);
    }

    cachedAccessToken = {
      storeDomain: config.storeDomain,
      value: payload.access_token,
      expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
    };
    return payload.access_token;
  })();

  try {
    return await pendingAccessToken;
  } finally {
    pendingAccessToken = null;
  }
}

export async function shopifyApiRequest(
  config: ShopifyConfig,
  input: ShopifyRequestInput,
): Promise<unknown> {
  const url = `https://${config.storeDomain}/admin/api/${config.apiVersion}${input.path}`;
  const hasBody = input.body !== undefined;
  const accessToken = await getShopifyAccessToken(config);

  let response: Response;
  let text = "";
  for (let attempt = 0; ; attempt += 1) {
    await shopifyRateSlot();
    try {
      response = await fetch(url, {
        method: input.method ?? "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new ShopifyApiError(
        timedOut
          ? "Shopify 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : "Shopify Admin API에 연결하지 못했습니다.",
        timedOut ? 504 : 502,
        null,
      );
    }
    text = await response.text();
    // 429는 잘못된 요청이 아니라 "지금은 말고 잠시 뒤에"라는 뜻이다. 실패로 처리하면
    // 그 상품은 반영되지 않은 채 남고, 다음 주기에 다시 시도하다 또 막힌다.
    if ((response.status === 429 || response.status === 503) && attempt < SHOPIFY_MAX_RETRIES) {
      await sleepMs(retryAfterMs(response, attempt));
      continue;
    }
    break;
  }

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
      response.status === 429
        ? "Shopify 호출 한도를 넘겨 잠시 뒤 다시 시도해야 합니다."
        : "Shopify Admin API request failed.",
      response.status,
      body,
    );
  }

  return body;
}

/**
 * Shopify REST Admin API는 초당 2회를 넘기면 429를 돌려준다. 여러 상품을 동시에
 * 처리하면 금방 넘어가고, 그때마다 실패로 적히면 반영되지 않은 상품이 쌓인다.
 * 한 실행 안에서 요청을 줄 세워 간격을 지킨다.
 */
const SHOPIFY_MIN_INTERVAL_MS = 550;
const SHOPIFY_MAX_RETRIES = 4;
let shopifyGate: Promise<unknown> = Promise.resolve();

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function shopifyRateSlot() {
  const slot = shopifyGate.then(() => sleepMs(SHOPIFY_MIN_INTERVAL_MS));
  // 실패한 요청이 줄을 끊지 않도록 한다.
  shopifyGate = slot.catch(() => undefined);
  return slot;
}

/** eBay와 달리 Shopify는 얼마나 기다리라고 알려 준다. 알려 주면 그대로 따른다. */
function retryAfterMs(response: Response, attempt: number) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 10_000);
  return Math.min(1000 * 2 ** attempt, 8_000);
}

export async function getShopifyProductViewUrl(productId: string, allowAdminFallback = true) {
  const config = getShopifyConfig();
  const normalizedProductId = idFromGid(productId);
  if (!normalizedProductId) {
    throw new ShopifyApiError("Shopify 상품 ID가 올바르지 않습니다.", 422, null);
  }

  const response = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query: `query productViewUrl($id: ID!) {
        shop { primaryDomain { url } }
        product(id: $id) { onlineStoreUrl status publishedAt handle }
      }`,
      variables: { id: `gid://shopify/Product/${normalizedProductId}` },
    },
  })) as {
    data?: { shop?: { primaryDomain?: { url?: string } }; product?: { onlineStoreUrl?: string | null; status?: string; publishedAt?: string | null; handle?: string } | null };
    errors?: Array<{ message?: string }>;
  } | null;

  if (response?.errors?.length || !response?.data?.product) {
    throw new ShopifyApiError("Shopify 상품을 찾을 수 없습니다.", 404, null);
  }

  return (
    response.data.product.onlineStoreUrl ??
    (response.data.product.status === "ACTIVE" && response.data.product.publishedAt && response.data.product.handle && response.data.shop?.primaryDomain?.url
      ? new URL(`/products/${encodeURIComponent(response.data.product.handle)}`, response.data.shop.primaryDomain.url).href : null) ??
    (allowAdminFallback ? shopifyAdminProductUrl(config.storeDomain, normalizedProductId) : null)
  );
}

export async function publishExistingShopifyProduct(productId: string, userId?: string) {
  if (!userId) throw new ShopifyApiError("게시 이미지 검증에 필요한 관리자 정보가 없습니다.", 422, null);
  const config = getShopifyConfig();
  const request = (input: ShopifyRequestInput) => shopifyApiRequest(config, input);
  const publicationId = await onlineStorePublication(request);
  const products = await prisma.product.findMany({ where: { shopifyProductId: idFromGid(productId) }, orderBy: { sku: "asc" } });
  if (!products.length) throw new ShopifyApiError("연결된 상품이 없어 게시 이미지 검증을 중단했습니다.", 409, null);
  const prepared = await Promise.all(products.map((product) => prepareProductChannelImages(userId, product)));
  let thumbnailUrl: string | null = null;
  if (products.length > 1) {
    const states = await prisma.variationListingState.findMany({ where: { userId, thumbnailStatus: "READY" }, orderBy: { thumbnailGeneratedAt: "desc" } });
    const ids = new Set(products.map((product) => product.id));
    thumbnailUrl = states.find((state) => Array.isArray(state.thumbnailProductIds) && state.thumbnailProductIds.length === ids.size && state.thumbnailProductIds.every((id) => typeof id === "string" && ids.has(id)))?.thumbnailUrl ?? null;
    if (!thumbnailUrl) throw new ShopifyApiError("전체 옵션과 일치하는 묶음 대표 이미지가 없어 게시를 중단했습니다.", 409, null);
  }
  const expected = [...(thumbnailUrl ? [thumbnailUrl] : []), ...prepared.flatMap(collectImageUrls)];
  await assertShopifyGallery(request, productId, expected);
  await publishOnlineStore(request, productId, publicationId);
}

async function resolveShopifyPriceString(product: Product) {
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  if (!settings) throw new ShopifyApiError("가격 설정을 먼저 저장해 주세요.", 422, null);
  const [verified] = await withVerifiedProcurementEvidence([product]);
  return resolveListingPriceUsd(verified, settings)?.priceUsd.toFixed(2);
}

function collectImageUrls(product: Product): string[] {
  return [...new Set([
    ...(product.ebayImageUrls ?? []),
    product.imageUrl ?? "",
  ].filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
    .map((url) => url.trim()))];
}

let cachedLocationId: { domain: string; id: string } | null = null;

async function resolvePrimaryLocationId(
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
    variants?: Array<{ id: number; inventory_item_id?: number }>;
  };
};

type ShopifyLinkedVariant = {
  productId: string;
  variantId: string;
  inventoryItemId: string | null;
  status: string | null;
};

function idFromGid(value: string | undefined | null) {
  return value?.split("/").filter(Boolean).at(-1) ?? null;
}

async function findShopifyVariantBySku(
  config: ShopifyConfig,
  sku: string,
): Promise<ShopifyLinkedVariant | null> {
  const query = `query findVariantBySku($search: String!) {
    productVariants(first: 3, query: $search) {
      nodes {
        id
        sku
        inventoryItem { id }
        product { id status }
      }
    }
  }`;
  const response = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query,
      variables: { search: `sku:${JSON.stringify(sku)}` },
    },
  })) as {
    data?: {
      productVariants?: {
        nodes?: Array<{
          id?: string;
          sku?: string;
          inventoryItem?: { id?: string } | null;
          product?: { id?: string; status?: string } | null;
        }>;
      };
    };
    errors?: unknown;
  } | null;

  if (response?.errors) {
    throw new ShopifyApiError(
      "Shopify SKU 중복 확인에 실패했습니다.",
      502,
      null,
    );
  }

  const exactMatches = (response?.data?.productVariants?.nodes ?? []).filter(
    (node) => node.sku === sku,
  );
  if (exactMatches.length > 1) {
    throw new ShopifyApiError(
      `Shopify에 같은 SKU(${sku})가 두 개 이상 있어 자동 등록을 중단했습니다.`,
      409,
      null,
    );
  }

  const match = exactMatches[0];
  const productId = idFromGid(match?.product?.id);
  const variantId = idFromGid(match?.id);
  if (!match || !productId || !variantId) {
    return null;
  }

  return {
    productId,
    variantId,
    inventoryItemId: idFromGid(match.inventoryItem?.id),
    status: match.product?.status?.toLowerCase() ?? null,
  };
}

export type ShopifyUploadResult = {
  productId: string;
  variantId: string | null;
  inventoryItemId: string | null;
  status: string | null;
  action: "created" | "updated";
  inventorySynced: boolean;
  syncMode: "full" | "price_inventory" | "images" | "archive";
  durationMs: number;
};

export async function uploadVariationGroupToShopify(
  group: VariationListingGroup<Product>,
  userId?: string,
) {
  const startedAt = Date.now();
  if (!userId) throw new ShopifyApiError("묶음 이미지 설정을 적용할 관리자 정보가 없습니다.", 422, null);
  group = { ...group, products: await refreshProcurementGroup(group.products, userId) };
  const config = getShopifyConfig();
  const publicationRequest = (input: ShopifyRequestInput) => shopifyApiRequest(config, input);
  const publicationId = await onlineStorePublication(publicationRequest);
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  if (!settings) throw new ShopifyApiError("가격 설정을 먼저 저장해 주세요.", 422, null);
  const linkedProductIds = [...new Set(group.products.map((product) => product.shopifyProductId).filter(Boolean))] as string[];
  const locationId = await resolvePrimaryLocationId(config);
  if (!locationId) throw new ShopifyApiError("Shopify의 활성 재고 위치를 찾을 수 없습니다.", 409, null);
  const locationGid = locationId.startsWith("gid://") ? locationId : `gid://shopify/Location/${locationId}`;
  const productId = linkedProductIds
    .map((id) => ({
      id,
      count: group.products.filter((product) => product.shopifyProductId === id).length,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))[0]?.id ?? null;
  const mergedSourceProductIds = linkedProductIds.filter((id) => id !== productId);
  const variants = group.products.map((product) => {
    const price = resolveListingPriceUsd(product, settings)?.priceUsd.toFixed(2);
    if (!price) throw new ShopifyApiError(`${product.sku}: Shopify 등록 가격이 없습니다.`, 422, null);
    return {
      ...(product.shopifyProductId === productId && product.shopifyVariantId
        ? { id: `gid://shopify/ProductVariant/${idFromGid(product.shopifyVariantId)}` }
        : {}),
      optionValues: [{ optionName: "Card", name: product.variationName }],
      sku: product.sku,
      price,
      inventoryItem: { tracked: true },
      inventoryQuantities: [{ locationId: locationGid, name: "available", quantity: listingQuantity(product) }],
    };
  });
  // Validate the complete gallery against approved sources, including the cover.
  const approvedSources = await Promise.all(group.products.map(prepareProductListingSource));
  const thumbnail = await (await import("@/lib/variation-thumbnail-prepare")).ensureVariationThumbnail(userId, { ...group, products: approvedSources });
  const channelProducts = await Promise.all(
    group.products.map((product) => prepareProductChannelImages(userId, product)),
  );
  const images = [...new Set([
    ...(thumbnail ? [thumbnail.url] : []),
    ...channelProducts.flatMap((product) => collectImageUrls(product)),
  ])];
  if (!images.length) throw new ShopifyApiError(`${group.title}: Shopify 등록 이미지가 없습니다.`, 422, null);
  const query = `mutation upsertVariationProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(synchronous: true, input: $input, identifier: $identifier) {
      product {
        id legacyResourceId status
        variants(first: 100) { nodes { id legacyResourceId sku inventoryItem { id legacyResourceId } } }
      }
      userErrors { field message }
    }
  }`;
  const response = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query,
      variables: {
        identifier: productId ? { id: `gid://shopify/Product/${idFromGid(productId)}` } : null,
        input: {
          title: buildEbayVariationListingTitle(group),
          descriptionHtml: buildShopifyVariationBodyHtml(group),
          vendor: group.groupName,
          productType: "Photocard",
          tags: [group.groupName, group.albumName, "Photocard", "K-Pop"].filter(Boolean),
          status: "ACTIVE",
          category: PHOTOCARD_TAXONOMY_CATEGORY,
          ...(!productId ? { files: images.map((originalSource) => ({ originalSource, contentType: "IMAGE" })) } : {}),
          productOptions: [{ name: "Card", position: 1, values: group.products.map((product) => ({ name: product.variationName })) }],
          variants: variants.map((variant, index) => ({
            ...variant,
            ...(!productId ? {
              file: { originalSource: collectImageUrls(channelProducts[index])[0], contentType: "IMAGE" },
            } : {}),
          })),
        },
      },
    },
  })) as {
    data?: { productSet?: { product?: { id?: string; legacyResourceId?: string; status?: string; variants?: { nodes?: Array<{ id?: string; legacyResourceId?: string; sku?: string; inventoryItem?: { id?: string; legacyResourceId?: string } }> } }; userErrors?: Array<{ field?: string[]; message?: string }> } };
    errors?: unknown;
  } | null;
  const payload = response?.data?.productSet;
  const errorMessage = graphqlUserErrorMessage(payload?.userErrors);
  if (response?.errors || errorMessage) throw new ShopifyApiError(errorMessage || "Shopify 옵션상품 등록에 실패했습니다.", 422, null);
  const savedProductId = payload?.product?.legacyResourceId ?? idFromGid(payload?.product?.id);
  if (!savedProductId) throw new ShopifyApiError("Shopify 상품 ID를 확인하지 못했습니다.", 502, null);
  const bySku = new Map((payload?.product?.variants?.nodes ?? []).map((variant) => [variant.sku, variant]));
  for (const sourceProductId of mergedSourceProductIds) {
    const archived = (await shopifyApiRequest(config, {
      method: "POST",
      path: "/graphql.json",
      body: {
        query: `mutation archiveMergedProduct($productId: ID!) {
          productChangeStatus(productId: $productId, status: ARCHIVED) {
            product { id status }
            userErrors { field message }
          }
        }`,
        variables: { productId: `gid://shopify/Product/${idFromGid(sourceProductId)}` },
      },
    })) as {
      data?: { productChangeStatus?: { product?: { id?: string }; userErrors?: Array<{ field?: string[]; message?: string }> } };
      errors?: unknown;
    } | null;
    const archiveError = graphqlUserErrorMessage(archived?.data?.productChangeStatus?.userErrors);
    if (archived?.errors || archiveError || !archived?.data?.productChangeStatus?.product?.id) {
      throw new ShopifyApiError(
        archiveError || `${group.title}: 기존 분리 상품을 보관 처리하지 못했습니다.`,
        502,
        null,
      );
    }
  }
  await prisma.$transaction(group.products.map((product) => {
    const variant = bySku.get(product.sku);
    const variantId = variant?.legacyResourceId ?? idFromGid(variant?.id);
    const inventoryItemId = variant?.inventoryItem?.legacyResourceId ?? idFromGid(variant?.inventoryItem?.id);
    if (!variantId || !inventoryItemId) throw new ShopifyApiError(`${product.sku}: Shopify 옵션 결과 ID가 없습니다.`, 502, null);
    return prisma.product.update({
      where: { id: product.id },
      data: {
        shopifyProductId: savedProductId,
        shopifyVariantId: variantId,
        shopifyInventoryItemId: inventoryItemId,
        shopifyStatus: "publication_pending",
        shopifyLastUploadedAt: new Date(),
        shopifyLastSyncedPrice: variants.find((candidate) => candidate.sku === product.sku)?.price ?? null,
        shopifyLastSyncedQuantity: listingQuantity(product),
        shopifyUploadError: null,
      },
    });
  }));
  await assertShopifyGallery(publicationRequest, savedProductId, images);
  await publishOnlineStore(publicationRequest, savedProductId, publicationId);
  await prisma.$transaction(group.products.map((product) => prisma.product.update({ where: { id: product.id }, data: { shopifyStatus: "active", shopifyUploadError: null } })));
  return {
    productId: savedProductId,
    variantId: null,
    inventoryItemId: null,
    status: payload?.product?.status?.toLowerCase() ?? "active",
    action: productId ? "updated" as const : "created" as const,
    inventorySynced: true,
    syncMode: "full" as const,
    durationMs: Date.now() - startedAt,
  };
}

type ShopifyMediaNode = {
  id: string;
  status: string;
  image?: { url?: string | null } | null;
};

function graphqlUserErrorMessage(
  errors: Array<{ field?: string[] | null; message?: string | null }> | undefined,
) {
  return (errors ?? [])
    .map((error) => [error.field?.join("."), error.message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
}

async function getShopifyProductMedia(
  config: ShopifyConfig,
  productId: string,
  requireSingleVariant = false,
): Promise<ShopifyMediaNode[]> {
  const response = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query: `query productMedia($id: ID!) {
        product(id: $id) {
          variants(first: 2) { nodes { id } }
          media(first: 250) {
            nodes {
              id
              status
              ... on MediaImage { image { url } }
            }
          }
        }
      }`,
      variables: { id: `gid://shopify/Product/${productId}` },
    },
  })) as {
    data?: { product?: { variants?: { nodes?: Array<{ id: string }> }; media?: { nodes?: ShopifyMediaNode[] } } | null };
    errors?: Array<{ message?: string }>;
  } | null;
  if (!response?.errors?.length && response?.data?.product === null) {
    throw new ShopifyApiError("Shopify 상품을 찾을 수 없습니다.", 404, null);
  }
  if (response?.errors?.length || !response?.data?.product) {
    throw new ShopifyApiError(
      response?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        "Shopify 상품 이미지를 조회하지 못했습니다.",
      502,
      null,
    );
  }
  if (requireSingleVariant && (response.data.product.variants?.nodes?.length ?? 0) !== 1) {
    throw new ShopifyApiError("묶음상품이거나 옵션 구성을 확인할 수 없어 개별 이미지 교체를 중단했습니다. 기존 이미지는 유지했습니다.", 409, null);
  }
  return response.data.product.media?.nodes ?? [];
}

export async function getShopifyProductImageUrls(productId: string) {
  const media = await getShopifyProductMedia(getShopifyConfig(), productId);
  return media
    .map((item) => item.image?.url?.trim() ?? "")
    .filter(Boolean);
}

/**
 * Replace a linked product's image gallery without leaving it blank.
 *
 * Shopify ingests remote media asynchronously, so new approved images are
 * created first. Existing media is deleted only after every new image is READY.
 * A failed or timed-out ingest therefore leaves the currently published image
 * intact and can be retried safely.
 */
export async function syncShopifyImages(
  product: Product,
  userId?: string,
  includeWholeGroup = false,
): Promise<ShopifyUploadResult> {
  if (!userId) throw new ShopifyApiError("승인 이미지 설정을 적용할 관리자 정보가 없습니다.", 422, null);
  product = await refreshProcurementProduct(product, userId);
  const startedAt = Date.now();
  const productId = product.shopifyProductId;
  if (!productId || !product.shopifyVariantId || !product.shopifyInventoryItemId) {
    throw new ShopifyApiError(
      "이미지를 교체하려면 먼저 Shopify 상품을 등록해야 합니다.",
      409,
      null,
    );
  }

  // Media belongs to the Shopify parent, not a single inventory card. Do not
  // replace a shared gallery with one selected variant's image.
  const sibling = await prisma.product.findFirst({
    where: { shopifyProductId: productId, id: { not: product.id } },
    select: { id: true },
  });
  if (sibling) {
    if (includeWholeGroup) return syncShopifyGroupImages(product, userId);
    throw new ShopifyApiError(
      "묶음상품은 개별 카드 이미지 교체를 지원하지 않습니다. 기존 묶음 대표 이미지와 옵션 이미지를 보호하기 위해 중단했습니다.",
      409,
      null,
    );
  }

  const channelProduct = await prepareProductChannelImages(userId, product);
  const images = collectImageUrls(channelProduct);
  if (!images.length) {
    throw new ShopifyApiError("교체할 승인 이미지가 없습니다.", 422, null);
  }

  const result = await replaceShopifyImages(product, images);
  return { ...result, durationMs: Date.now() - startedAt };
}

async function syncShopifyGroupImages(product: Product, userId: string) {
  const productId = product.shopifyProductId!;
  const config = getShopifyConfig();
  const request = (input: ShopifyRequestInput) => shopifyApiRequest(config, input);
  const products = await prisma.product.findMany({ where: { shopifyProductId: productId }, orderBy: { sku: "asc" } });
  const snapshot = await request({ method: "POST", path: "/graphql.json", body: {
    query: `query registeredGalleryVariants($id: ID!) { product(id: $id) { variants(first: 250) { pageInfo { hasNextPage } nodes { id sku title } } } }`,
    variables: { id: `gid://shopify/Product/${productId}` },
  } }) as { errors?: unknown[]; data?: { product?: { variants: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ id: string; sku: string; title: string }> } } } };
  const remote = snapshot.data?.product?.variants;
  if (snapshot.errors?.length || !remote || remote.pageInfo.hasNextPage || remote.nodes.length !== products.length || products.length < 2 || new Set(remote.nodes.map((v) => v.sku)).size !== products.length || products.some((p) => !remote.nodes.some((v) => v.sku === p.sku && idFromGid(v.id) === p.shopifyVariantId))) {
    // 무엇이 어긋났는지 알려 줘야 사람이 연결을 고칠 수 있다.
    const remoteSkus = new Set((remote?.nodes ?? []).map((node) => node.sku));
    const missing = products.filter((item) => !remoteSkus.has(item.sku)).map((item) => item.sku);
    const detail = [
      `저장 ${products.length}개 · Shopify ${remote?.nodes.length ?? 0}개`,
      missing.length ? `Shopify에 없는 상품번호: ${missing.slice(0, 5).join(", ")}` : null,
      remote?.pageInfo.hasNextPage ? "옵션이 250개를 넘어 전체를 확인하지 못함" : null,
      products.length < 2 ? "묶음이 아님" : null,
    ].filter(Boolean).join(" / ");
    throw new ShopifyApiError(
      `저장된 전체 옵션과 Shopify 옵션이 일치하지 않아 묶음 이미지 교체를 중단했습니다. (${detail})`,
      409,
      null,
    );
  }
  const sources = await Promise.all(products.map(prepareProductListingSource));
  const group: VariationListingGroup = {
    key: `shopify:${productId}`, groupName: product.brand ?? "", albumName: product.category ?? "", versionName: "",
    title: [product.brand, product.category].filter(Boolean).join(" "),
    products: sources.map((p) => ({ ...p, variationName: remote.nodes.find((v) => v.sku === p.sku)!.title })),
  };
  const thumbnail = await (await import("@/lib/variation-thumbnail-prepare")).ensureVariationThumbnail(userId, group);
  const prepared = await Promise.all(products.map((p) => prepareProductChannelImages(userId, p)));
  const images = [...new Set([thumbnail.url, ...prepared.flatMap(collectImageUrls)])];
  return replaceShopifyImages(product, images, false, async (media) => {
    const variants = prepared.map((p) => {
      const identity = shopifyImageIdentity(collectImageUrls(p)[0]);
      const found = media.filter((m) => shopifyImageIdentity(m.image?.url ?? "") === identity);
      if (found.length !== 1) throw new ShopifyApiError(`${p.sku}: 새 옵션 이미지를 확인하지 못했습니다. 기존 이미지를 유지합니다.`, 502, null);
      return { id: remote.nodes.find((v) => v.sku === p.sku)!.id, mediaId: found[0].id };
    });
    const result = await request({ method: "POST", path: "/graphql.json", body: {
      query: `mutation linkApprovedVariantImages($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id media(first: 10) { nodes { id } } } userErrors { message } } }`,
      variables: { productId: `gid://shopify/Product/${productId}`, variants },
    } }) as { errors?: unknown[]; data?: { productVariantsBulkUpdate?: { productVariants?: Array<{ id: string; media: { nodes: Array<{ id: string }> } }>; userErrors: Array<{ message: string }> } } };
    const updated = result.data?.productVariantsBulkUpdate;
    if (result.errors?.length || !updated || updated.userErrors.length || updated.productVariants?.length !== variants.length || variants.some((variant) => !updated.productVariants?.find((v) => v.id === variant.id)?.media.nodes.some((m) => m.id === variant.mediaId))) throw new ShopifyApiError("옵션 이미지 연결이 확인되지 않아 기존 이미지를 유지했습니다.", 502, null);
  });
}

async function replaceShopifyImages(product: Product, images: string[], requireSingleVariant = true,
  beforeDelete?: (media: ShopifyMediaNode[]) => Promise<void>): Promise<ShopifyUploadResult> {
  const startedAt = Date.now();
  const productId = product.shopifyProductId!;
  const config = getShopifyConfig();
  const existingMedia = await getShopifyProductMedia(config, productId, requireSingleVariant);
  const response = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query: `mutation replaceProductImages($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) {
          product { media(first: 250) { nodes { id status } } }
          userErrors { field message }
        }
      }`,
      variables: {
        product: { id: `gid://shopify/Product/${productId}` },
        media: images.map((originalSource) => ({
          originalSource,
          mediaContentType: "IMAGE",
          alt: product.productName,
        })),
      },
    },
  })) as {
    data?: {
      productUpdate?: {
        product?: { media?: { nodes?: ShopifyMediaNode[] } } | null;
        userErrors?: Array<{ field?: string[] | null; message?: string | null }>;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  } | null;

  const userError = graphqlUserErrorMessage(response?.data?.productUpdate?.userErrors);
  if (response?.errors?.length || userError || !response?.data?.productUpdate?.product) {
    throw new ShopifyApiError(
      userError ||
        response?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        "Shopify가 새 이미지를 받지 못했습니다.",
      422,
      null,
    );
  }

  const previousIds = new Set(existingMedia.map((media) => media.id));
  let newMedia = (response.data.productUpdate.product.media?.nodes ?? []).filter(
    (media) => !previousIds.has(media.id),
  );
  if (newMedia.length !== images.length) {
    throw new ShopifyApiError(
      "Shopify가 생성한 이미지 수를 확인하지 못했습니다. 기존 이미지는 유지했습니다.",
      502,
      null,
    );
  }

  const newMediaIds = new Set(newMedia.map((media) => media.id));
  const readyDeadline = Date.now() + 12_000;
  while (newMedia.some((media) => media.status !== "READY")) {
    if (newMedia.some((media) => media.status === "FAILED")) {
      throw new ShopifyApiError(
        "Shopify가 새 이미지 처리에 실패했습니다. 기존 이미지는 유지했습니다.",
        502,
        null,
      );
    }
    if (Date.now() >= readyDeadline) {
      throw new ShopifyApiError(
        "Shopify 이미지 준비가 12초를 넘겨 중단했습니다. 기존 이미지는 유지했습니다.",
        504,
        null,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    const current = await getShopifyProductMedia(config, productId);
    // GraphQL can briefly omit a media node while Shopify is ingesting it.
    // Treat an omitted node as still processing; never interpret it as READY.
    newMedia = [...newMediaIds].map(
      (id) => current.find((media) => media.id === id) ?? { id, status: "PROCESSING" },
    );
  }

  if (beforeDelete) await beforeDelete(await getShopifyProductMedia(config, productId).then((media) => media.filter((item) => newMediaIds.has(item.id))));
  if (existingMedia.length) {
    const deleted = (await shopifyApiRequest(config, {
      method: "POST",
      path: "/graphql.json",
      body: {
        query: `mutation deleteOldProductImages($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            mediaUserErrors { field message }
          }
        }`,
        variables: {
          productId: `gid://shopify/Product/${productId}`,
          mediaIds: existingMedia.map((media) => media.id),
        },
      },
    })) as {
      data?: {
        productDeleteMedia?: {
          mediaUserErrors?: Array<{ field?: string[] | null; message?: string | null }>;
        } | null;
      };
      errors?: Array<{ message?: string }>;
    } | null;
    const deleteError = graphqlUserErrorMessage(
      deleted?.data?.productDeleteMedia?.mediaUserErrors,
    );
    if (deleted?.errors?.length || deleteError) {
      throw new ShopifyApiError(
        deleteError || "Shopify의 이전 이미지를 정리하지 못했습니다.",
        502,
        null,
      );
    }
  }

  await assertShopifyGallery((input) => shopifyApiRequest(config, input), productId, images);
  return {
    productId,
    variantId: product.shopifyVariantId,
    inventoryItemId: product.shopifyInventoryItemId,
    status: product.shopifyStatus,
    action: "updated",
    inventorySynced: false,
    syncMode: "images",
    durationMs: Date.now() - startedAt,
  };
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
      ["Member", cardMembers(listingProduct.featuredMembers).join(", ") || specifics["Featured Person/Artist"]],
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

export function buildShopifyVariationBodyHtml(group: VariationListingGroup<Product>): string {
  const first = group.products[0];
  if (!first) throw new Error("옵션 상품이 없습니다.");
  const parent = { ...first, brand: group.groupName,
    category: listingAlbumContext(group.groupName, group.albumName, group.versionName),
    optionName: "", featuredMembers: "", ebayTitle: null };
  return buildShopifyBodyHtml(parent, buildEbayListingItemSpecifics(parent)) + variationMembersDescription(group.products);
}

// Sets the Shopify standard product category via GraphQL (REST can't write it).
// Best-effort: never throws, so a category hiccup can't fail the whole upload.
async function setShopifyProductCategory(
  config: ShopifyConfig,
  productId: string,
  categoryGid: string,
): Promise<void> {
  try {
    const accessToken = await getShopifyAccessToken(config);
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
          "X-Shopify-Access-Token": accessToken,
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
        signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
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

export async function uploadProductToShopify(
  product: Product,
  extras?: ProductImageExtras,
  userId?: string,
): Promise<ShopifyUploadResult> {
  if (!userId) throw new ShopifyApiError("승인 이미지 설정을 적용할 관리자 정보가 없습니다.", 422, null);
  product = await refreshProcurementProduct(product, userId);
  const startedAt = Date.now();
  const config = getShopifyConfig();
  const publicationRequest = (input: ShopifyRequestInput) => shopifyApiRequest(config, input);
  const publicationId = await onlineStorePublication(publicationRequest);

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
        ...cardMembers(listingProduct.featuredMembers),
        specifics.Set,
        specifics.Genre,
        "Photocard",
      ]
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
  const price = await resolveShopifyPriceString(product);
  const channelProduct = await prepareProductChannelImages(userId, product);
  const images = collectImageUrls(channelProduct);

  if (!product.sku.trim()) {
    throw new ShopifyApiError("Shopify 등록용 SKU가 필요합니다.", 422, null);
  }
  if (!title.trim()) {
    throw new ShopifyApiError("Shopify 상품명이 필요합니다.", 422, null);
  }
  if (price === undefined) {
    throw new ShopifyApiError("Shopify 등록용 판매가를 확인해 주세요.", 422, null);
  }
  if (!images.length) {
    throw new ShopifyApiError("Shopify 등록용 상품 이미지가 필요합니다.", 422, null);
  }

  const variant: Record<string, unknown> = {
    sku: product.sku,
    inventory_management: "shopify",
  };
  if (price !== undefined) {
    variant.price = price;
  }

  let linked = product.shopifyProductId
    ? {
        productId: product.shopifyProductId,
        variantId: product.shopifyVariantId,
        inventoryItemId: product.shopifyInventoryItemId,
        status: product.shopifyStatus,
      }
    : await findShopifyVariantBySku(config, product.sku);
  let isUpdate = Boolean(linked?.productId);

  const productPayload: Record<string, unknown> = {
    title,
    body_html: bodyHtml || undefined,
    vendor: product.brand ?? undefined,
    product_type: "Photocard",
    tags: tags.join(", "),
    status: "active",
  };

  async function createProduct() {
    const locationId = await resolvePrimaryLocationId(config);
    if (!locationId) {
      throw new ShopifyApiError(
        "Shopify의 활성 재고 위치를 찾을 수 없습니다.",
        409,
        null,
      );
    }
    const locationGid = locationId.startsWith("gid://")
      ? locationId
      : `gid://shopify/Location/${locationId}`;
    const query = `mutation createProduct($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product {
          id
          legacyResourceId
          status
          variants(first: 1) {
            nodes {
              id
              legacyResourceId
              inventoryItem { id legacyResourceId }
            }
          }
        }
        userErrors { field message }
      }
    }`;
    const graphqlResponse = (await shopifyApiRequest(config, {
      method: "POST",
      path: "/graphql.json",
      body: {
        query,
        variables: {
          input: {
            title,
            descriptionHtml: bodyHtml || undefined,
            vendor: product.brand ?? undefined,
            productType: "Photocard",
            tags,
            status: "ACTIVE",
            category: PHOTOCARD_TAXONOMY_CATEGORY,
            files: images.map((originalSource) => ({
              originalSource,
              contentType: "IMAGE",
            })),
            productOptions: [
              {
                name: "Title",
                position: 1,
                values: [{ name: "Default Title" }],
              },
            ],
            variants: [
              {
                optionValues: [{ optionName: "Title", name: "Default Title" }],
                sku: product.sku,
                price,
                inventoryItem: { tracked: true },
                inventoryQuantities: [
                  {
                    locationId: locationGid,
                    name: "available",
                    quantity: listingQuantity(product),
                  },
                ],
              },
            ],
          },
        },
      },
    })) as {
      data?: {
        productSet?: {
          product?: {
            id?: string;
            legacyResourceId?: string;
            status?: string;
            variants?: {
              nodes?: Array<{
                id?: string;
                legacyResourceId?: string;
                inventoryItem?: { id?: string; legacyResourceId?: string } | null;
              }>;
            };
          } | null;
          userErrors?: Array<{ field?: string[] | null; message?: string }>;
        };
      };
      errors?: unknown;
    } | null;
    const payload = graphqlResponse?.data?.productSet;
    const userErrors = payload?.userErrors ?? [];
    if (graphqlResponse?.errors || userErrors.length) {
      throw new ShopifyApiError(
        userErrors.map((error) => error.message).filter(Boolean).join(" / ") ||
          "Shopify GraphQL 상품 등록에 실패했습니다.",
        422,
        null,
      );
    }
    const created = payload?.product;
    const createdVariant = created?.variants?.nodes?.[0];
    const productLegacyId = created?.legacyResourceId ?? idFromGid(created?.id);
    const variantLegacyId =
      createdVariant?.legacyResourceId ?? idFromGid(createdVariant?.id);
    const inventoryLegacyId =
      createdVariant?.inventoryItem?.legacyResourceId ??
      idFromGid(createdVariant?.inventoryItem?.id);
    if (!productLegacyId || !variantLegacyId || !inventoryLegacyId) {
      throw new ShopifyApiError(
        "Shopify가 등록 결과 식별자를 반환하지 않았습니다.",
        502,
        null,
      );
    }
    return {
      product: {
        id: Number(productLegacyId),
        status: created?.status?.toLowerCase(),
        variants: [
          {
            id: Number(variantLegacyId),
            inventory_item_id: Number(inventoryLegacyId),
          },
        ],
      },
    } satisfies ShopifyProductResponse;
  }

  let response: ShopifyProductResponse;
  let action: "created" | "updated";

  if (isUpdate && linked) {
    // Update in place; keep the existing variant id so we don't duplicate it.
    // Images aren't re-sent on update (would append duplicates).
    const updatePayload: Record<string, unknown> = {
      ...productPayload,
      variants: [
        linked.variantId
          ? { ...variant, id: Number(linked.variantId) }
          : { ...variant },
      ],
    };
    try {
      await getShopifyProductMedia(config, linked.productId, true);
      response = (await shopifyApiRequest(config, {
        method: "PUT",
        path: `/products/${linked.productId}.json`,
        body: { product: updatePayload },
      })) as ShopifyProductResponse;
      action = "updated";
    } catch (error) {
      // The saved ID can be stale, or Shopify may have succeeded previously but
      // our response/DB update was lost. Recover by exact SKU before creating.
      if (error instanceof ShopifyApiError && error.status === 404) {
        linked = await findShopifyVariantBySku(config, product.sku);
        isUpdate = Boolean(linked?.productId);
        if (linked) {
          await getShopifyProductMedia(config, linked.productId, true);
          response = (await shopifyApiRequest(config, {
            method: "PUT",
            path: `/products/${linked.productId}.json`,
            body: {
              product: {
                ...productPayload,
                variants: [
                  linked.variantId
                    ? { ...variant, id: Number(linked.variantId) }
                    : { ...variant },
                ],
              },
            },
          })) as ShopifyProductResponse;
          action = "updated";
        } else {
          response = await createProduct();
          action = "created";
        }
      } else {
        throw error;
      }
    }
  } else {
    response = await createProduct();
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

  const firstVariant = created.variants?.[0];
  const variantId = firstVariant ? String(firstVariant.id) : null;
  const inventoryItemId = firstVariant?.inventory_item_id
    ? String(firstVariant.inventory_item_id)
    : linked?.inventoryItemId ?? product.shopifyInventoryItemId ?? null;

  if (!variantId || !inventoryItemId) {
    throw new ShopifyApiError(
      "Shopify가 variant 또는 inventory item ID를 반환하지 않았습니다. 재시도하면 SKU로 기존 상품을 복구합니다.",
      502,
      null,
    );
  }

  const inventorySync = action === "created" ? Promise.resolve() : (async () => {
    const locationId = await resolvePrimaryLocationId(config);
    if (!locationId) {
      throw new ShopifyApiError(
        "Shopify의 활성 재고 위치를 찾을 수 없습니다.",
        409,
        null,
      );
    }
    await shopifyApiRequest(config, {
      method: "POST",
      path: "/inventory_levels/set.json",
      body: {
        location_id: Number(locationId),
        inventory_item_id: Number(inventoryItemId),
        available: listingQuantity(product),
      },
    });
  })();

  // These calls are independent. Running them together saves one full network
  // round on every full registration/update while category remains best-effort.
  await Promise.all([
    inventorySync,
    action === "created"
      ? Promise.resolve()
      : setShopifyProductCategory(config, productId, PHOTOCARD_TAXONOMY_CATEGORY),
  ]);

  await prisma.product.update({ where: { id: product.id }, data: { shopifyProductId: productId, shopifyVariantId: variantId, shopifyInventoryItemId: inventoryItemId, shopifyStatus: "publication_pending" } });
  await assertShopifyGallery(publicationRequest, productId, images);
  await publishOnlineStore(publicationRequest, productId, publicationId);
  return {
    productId,
    variantId,
    inventoryItemId,
    status: created.status ?? linked?.status ?? null,
    action,
    inventorySynced: true,
    syncMode: "full",
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Sync only the fields changed by the price/inventory management screen.
 *
 * Verify a zero-stock hold, change and read back price, then release stock.
 * A rejected or unverifiable write leaves the exact variant held.
 */
/**
 * 저장된 옵션이 Shopify에서 실제로 사라졌는지 확인한다. 옵션 조회가 오류 없이
 * 비어 있고 상위 상품 조회까지 성공해야 "삭제됨"으로 본다. 통신·권한 문제와
 * 구분하지 않으면 일시적인 오류에 판매 연결을 잃는다.
 */
async function shopifyVariantConfirmedMissing(
  config: ShopifyConfig,
  product: { sku: string; shopifyProductId: string; shopifyVariantId: string },
) {
  const variantResponse = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query: `query linkProbe($id:ID!){productVariant(id:$id){id sku}}`,
      variables: { id: `gid://shopify/ProductVariant/${product.shopifyVariantId}` },
    },
  })) as { errors?: unknown[]; data?: { productVariant?: unknown } };
  if (variantResponse.errors?.length) return false;
  if (variantResponse.data?.productVariant) return false;
  const productResponse = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query: `query parentProbe($id:ID!){product(id:$id){id status}}`,
      variables: { id: `gid://shopify/Product/${product.shopifyProductId}` },
    },
  })) as { errors?: unknown[]; data?: { product?: unknown } };
  // 상위 상품 질의가 정상 응답했다면 스토어 접속과 권한은 문제가 없다.
  return !productResponse.errors?.length && productResponse.data !== undefined;
}

export async function syncShopifyPriceAndInventory(
  product: Product,
): Promise<ShopifyUploadResult> {
  const startedAt = Date.now();
  const productId = product.shopifyProductId;
  const variantId = product.shopifyVariantId;
  const inventoryItemId = product.shopifyInventoryItemId;

  if (!productId || !variantId || !inventoryItemId) {
    throw new ShopifyApiError(
      "가격·재고만 반영하려면 먼저 Shopify 상품을 등록해야 합니다.",
      409,
      null,
    );
  }

  const config = getShopifyConfig();
  const hold = () => holdShopifyVariantForMissingPrice(input => shopifyApiRequest(config, input), {
    sku: product.sku, shopifyProductId: productId, shopifyVariantId: variantId, shopifyInventoryItemId: inventoryItemId,
  });
  try {
  await hold();
  const price = await resolveShopifyPriceString(product);
  if (!price) {
    return { productId, variantId, inventoryItemId, status: "PRICE_HOLD", action: "updated",
      inventorySynced: true, syncMode: "price_inventory", durationMs: Date.now() - startedAt };
  }
  const locationIdPromise = resolvePrimaryLocationId(config);
  const pricePromise = price
    ? shopifyApiRequest(config, {
        method: "PUT",
        path: `/variants/${variantId}.json`,
        body: {
          variant: {
            id: Number(variantId),
            price,
          },
        },
      })
    : Promise.resolve();
  // A failed price update must never release stock at the old selling price.
  const inventoryPromise = Promise.all([locationIdPromise, pricePromise]).then(async ([locationId]) => {
    if (!locationId) {
      throw new ShopifyApiError(
        "Shopify의 활성 재고 위치를 찾을 수 없습니다.",
        409,
        null,
      );
    }

    const actual = await shopifyApiRequest(config, { path: `/variants/${variantId}.json` }) as { variant?: { price?: string | number } };
    if (actual?.variant?.price == null || !Number.isFinite(Number(actual.variant.price)) ||
        Math.abs(Number(actual.variant.price) - Number(price)) >= 0.01) {
      throw new ShopifyApiError(`${product.sku}: Shopify 실제 가격을 확인하지 못해 수량을 복구하지 않고 완료 처리하지 않았습니다.`, 409, null);
    }
    return shopifyApiRequest(config, {
      method: "POST",
      path: "/inventory_levels/set.json",
      body: {
        location_id: Number(locationId),
        inventory_item_id: Number(inventoryItemId),
        available: listingQuantity(product),
      },
    });
  });

  await Promise.all([pricePromise, inventoryPromise]);

  const expectedQuantity = listingQuantity(product);
  const verificationLocationId = await locationIdPromise;
  if (!verificationLocationId) {
    throw new ShopifyApiError("Shopify의 활성 재고 위치를 확인하지 못했습니다.", 409, null);
  }
  let verified = false;
  let verificationError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const [variantResponse, inventoryResponse] = await Promise.all([
        shopifyApiRequest(config, { path: `/variants/${variantId}.json` }),
        shopifyApiRequest(config, {
          path: `/inventory_levels.json?inventory_item_ids=${encodeURIComponent(inventoryItemId)}&location_ids=${encodeURIComponent(verificationLocationId)}`,
        }),
      ]) as [
        { variant?: { price?: string | number | null } } | null,
        { inventory_levels?: Array<{ available?: number | null }> } | null,
      ];
      const actualPrice = variantResponse?.variant?.price;
      const actualQuantity = inventoryResponse?.inventory_levels?.[0]?.available;
      const priceMatches = !price || (
        actualPrice !== null && actualPrice !== undefined &&
        Math.abs(Number(actualPrice) - Number(price)) < 0.01
      );
      if (priceMatches && actualQuantity === expectedQuantity) {
        verified = true;
        break;
      }
    } catch (error) {
      verificationError = error;
    }
  }
  if (!verified) {
    throw new ShopifyApiError(
      verificationError
        ? `${product.sku}: Shopify 실제 가격·수량 재조회에 실패해 완료 처리하지 않았습니다.`
        : `${product.sku}: Shopify의 실제 가격·수량이 목표값과 일치하지 않아 완료 처리하지 않았습니다.`,
      409,
      null,
    );
  }

  // A price-review hold may only be released after the real USD price and
  // inventory have been read back successfully. The storefront uses this flag.
  if (price) {
    await setShopifyPriceHoldFlag(input => shopifyApiRequest(config, input), variantId, false);
  }

  return {
    productId,
    variantId,
    inventoryItemId,
    status: product.shopifyStatus,
    action: "updated",
    inventorySynced: true,
    syncMode: "price_inventory",
    durationMs: Date.now() - startedAt,
  };
  } catch (error) {
    // 원인을 지우면 화면에 "재시도가 필요합니다"만 남아 무엇을 고쳐야 할지 알 수 없다.
    const cause = error instanceof Error ? error.message : String(error);
    try { await hold(); }
    catch (holdError) {
      const holdCause =
        holdError instanceof Error ? holdError.message : String(holdError);
      // 반영도 보류도 안 되면 옵션 자체가 없어졌는지 확인한다. 실제로 삭제됐다면
      // 같은 실패를 매번 반복하는 대신 죽은 연결을 끊어 신규등록 대상으로 되돌린다.
      // 확인 질의 자체가 실패하면 삭제로 단정하지 않는다. 원래 실패를 그대로 알린다.
      const confirmedMissing = await shopifyVariantConfirmedMissing(config, {
        sku: product.sku,
        shopifyProductId: productId,
        shopifyVariantId: variantId,
      }).catch(() => false);
      if (confirmedMissing) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            shopifyProductId: null,
            shopifyVariantId: null,
            shopifyInventoryItemId: null,
            shopifyStatus: null,
          },
        });
        throw new ShopifyApiError(
          `${product.sku}: Shopify에서 이 옵션이 삭제되어 있어 연결을 해제했습니다. 신규등록으로 다시 올려 주세요.`,
          409,
          null,
        );
      }
      throw new ShopifyApiError(
        `${product.sku}: 가격·수량 반영 실패 후 판매 수량 0도 확인하지 못했습니다. 판매 보류 미확인 상태이며 재시도가 필요합니다. (반영 실패: ${cause} / 보류 실패: ${holdCause})`,
        503,
        null,
      );
    }
    throw error;
  }
}

export async function archiveShopifyProduct(
  product: Product,
): Promise<ShopifyUploadResult> {
  const startedAt = Date.now();
  const productId = idFromGid(product.shopifyProductId);
  if (!productId) {
    throw new ShopifyApiError(
      "판매중단하려면 먼저 Shopify 상품이 연결되어 있어야 합니다.",
      409,
      null,
    );
  }

  const config = getShopifyConfig();
  const response = (await shopifyApiRequest(config, {
    method: "POST",
    path: "/graphql.json",
    body: {
      query: `mutation archiveProduct($productId: ID!) {
        productChangeStatus(productId: $productId, status: ARCHIVED) {
          product { id status }
          userErrors { field message }
        }
      }`,
      variables: { productId: `gid://shopify/Product/${productId}` },
    },
  })) as {
    data?: {
      productChangeStatus?: {
        product?: { id?: string; status?: string } | null;
        userErrors?: Array<{ field?: string[] | null; message?: string | null }>;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  } | null;

  const result = response?.data?.productChangeStatus;
  const userError = graphqlUserErrorMessage(result?.userErrors);
  if (response?.errors?.length || userError || !result?.product?.id) {
    throw new ShopifyApiError(
      userError || "Shopify 상품 판매중단에 실패했습니다.",
      502,
      null,
    );
  }

  return {
    productId,
    variantId: product.shopifyVariantId,
    inventoryItemId: product.shopifyInventoryItemId,
    status: result.product.status?.toLowerCase() ?? "archived",
    action: "updated",
    inventorySynced: false,
    syncMode: "archive",
    durationMs: Date.now() - startedAt,
  };
}
