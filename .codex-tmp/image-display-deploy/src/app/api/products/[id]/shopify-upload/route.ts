import { refreshProcurementProduct } from "@/lib/procurement-refresh";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  ShopifyApiError,
  syncShopifyPriceAndInventory,
  uploadProductToShopify,
} from "@/lib/services/shopifyService";
import { getVariationCandidateProductIds } from "@/lib/variation-listing-products";
import { listingQuantity } from "@/lib/listing-quantity";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const user = await requireApiUser();

    let product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return jsonError("상품을 찾을 수 없습니다.", 404);
    }
    if (!product.shopifyProductId) {
      const variationCandidateIds = await getVariationCandidateProductIds();
      if (variationCandidateIds.has(product.id)) {
        return jsonError(
          "이 상품은 다른 카드와 옵션상품으로 묶을 수 있어 Shopify 개별 등록을 중단했습니다. 현재 Shopify 옵션 등록은 별도 지원이 필요합니다.",
          409,
        );
      }
    }

    const input = await request.json().catch(() => null) as {
      mode?: unknown;
    } | null;
    const priceInventoryOnly = input?.mode === "price_inventory";
    const canUseFastSync = Boolean(
      priceInventoryOnly &&
      product.shopifyProductId &&
      product.shopifyVariantId &&
      product.shopifyInventoryItemId,
    );

    product = await refreshProcurementProduct(product, user.id);
    const price = resolveListingPriceUsd(product, await prisma.pricingSettings.findUnique({ where: { id: "default" } }) ?? undefined);
    const result = canUseFastSync
      ? await syncShopifyPriceAndInventory(product)
      : await uploadProductToShopify(product, {
          featuredMembers: product.featuredMembers,
        }, user.id);

    const updated = await prisma.product.update({
      where: { id },
      data: {
        shopifyProductId: result.productId,
        shopifyVariantId: result.variantId,
        shopifyInventoryItemId: result.inventoryItemId,
        shopifyStatus: result.status,
        shopifyLastUploadedAt: new Date(),
        shopifyLastSyncedPrice: price?.priceUsd ?? null,
        shopifyLastSyncedQuantity: price ? listingQuantity(product) : 0,
        shopifyUploadError: null,
      },
      select: {
        id: true,
        shopifyProductId: true,
        shopifyVariantId: true,
        shopifyStatus: true,
        shopifyLastUploadedAt: true,
      },
    });

    return Response.json({ ok: true, product: updated, shopify: result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    const message =
      error instanceof ShopifyApiError
        ? buildShopifyErrorMessage(error)
        : asErrorMessage(error);

    // Persist the failure so it shows up on the product page like eBay errors.
    await prisma.product
      .update({
        where: { id },
        data: { shopifyUploadError: message },
      })
      .catch(() => undefined);

    if (error instanceof ShopifyApiError) {
      return jsonError(
        message,
        error.status >= 400 && error.status < 600 ? error.status : 502,
      );
    }

    return jsonError(message, 500);
  }
}

function buildShopifyErrorMessage(error: ShopifyApiError): string {
  const details = error.details;
  if (details && typeof details === "object") {
    const errors = (details as { errors?: unknown }).errors;
    if (typeof errors === "string") {
      return `Shopify 업로드 실패: ${errors}`;
    }
    if (errors && typeof errors === "object") {
      const flattened = Object.entries(errors as Record<string, unknown>)
        .map(([field, value]) => {
          const text = Array.isArray(value) ? value.join(", ") : String(value);
          return `${field}: ${text}`;
        })
        .join(" / ");
      if (flattened) {
        return `Shopify 업로드 실패: ${flattened}`;
      }
    }
  }
  return `Shopify 업로드 실패 (HTTP ${error.status})`;
}
