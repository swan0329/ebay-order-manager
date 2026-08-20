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
import { sellableQuantity } from "@/lib/stock-reservation";
import { getShopifyAccessToken } from "@/lib/services/shopifyToken";

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

function decimalToPriceString(value: Product["salePrice"]): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return numeric.toFixed(2);
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
    variants?: Array<{ id: number; inventory_item_id?: number }>;
  };
};

export type ShopifyUploadResult = {
  productId: string;
  variantId: string | null;
  inventoryItemId: string | null;
  status: string | null;
  action: "created" | "updated";
  inventorySynced: boolean;
};

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
): Promise<ShopifyUploadResult> {
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
  const price = decimalToPriceString(product.ebayPrice ?? product.salePrice);
  const images = collectImageUrls(product);

  const variant: Record<string, unknown> = {
    sku: product.sku,
    inventory_management: "shopify",
  };
  if (price !== undefined) {
    variant.price = price;
  }

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
    return (await shopifyApiRequest(config, {
      method: "POST",
      path: "/products.json",
      body: { product: createPayload },
    })) as ShopifyProductResponse;
  }

  let response: ShopifyProductResponse;
  let action: "created" | "updated";

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
      // The product was deleted on Shopify (stale id) — recreate it instead of
      // failing the whole upload.
      if (error instanceof ShopifyApiError && error.status === 404) {
        response = await createProduct();
        action = "created";
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

  // Set the standard product category (GraphQL-only). Best-effort, non-fatal.
  await setShopifyProductCategory(config, productId, PHOTOCARD_TAXONOMY_CATEGORY);

  const firstVariant = created.variants?.[0];
  const variantId = firstVariant ? String(firstVariant.id) : null;
  const inventoryItemId = firstVariant?.inventory_item_id
    ? String(firstVariant.inventory_item_id)
    : product.shopifyInventoryItemId ?? null;

  let inventorySynced = false;
  if (inventoryItemId) {
    // 실재고가 아니라 판매 가능 수량을 올린다. 아직 처리하지 않은 주문이 잡아 둔
    // 몫까지 팔면 이미 나간 카드를 또 팔게 된다.
    try {
      await setShopifyInventoryLevel(
        config,
        inventoryItemId,
        sellableQuantity({
          stock: product.stockQuantity,
          reserved: reservedQuantity ?? 0,
          safetyStock: product.safetyStock ?? 0,
        }),
      );
      inventorySynced = true;
    } catch {
      // 재고 위치를 못 찾는 등으로 실패해도 상품 등록 자체는 살린다.
      inventorySynced = false;
    }
  }

  return {
    productId,
    variantId,
    inventoryItemId,
    status: created.status ?? null,
    action,
    inventorySynced,
  };
}
