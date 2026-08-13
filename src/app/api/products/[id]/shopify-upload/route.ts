import type { ProductImageExtras } from "@/lib/ebay-listing-fields";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  ShopifyApiError,
  uploadProductToShopify,
} from "@/lib/services/shopifyService";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    await requireApiUser();

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return jsonError("상품을 찾을 수 없습니다.", 404);
    }

    // featured_members lives in a raw column (not the Prisma model); fetch it so
    // "unit" cards get real member names in the title, matching the eBay listing.
    let extras: ProductImageExtras | undefined;
    try {
      const rows = await prisma.$queryRaw<Array<{ featuredMembers: string | null }>>`
        SELECT "featured_members" AS "featuredMembers"
        FROM "products" WHERE "id" = ${id} LIMIT 1
      `;
      extras = rows[0] ?? undefined;
    } catch {
      extras = undefined;
    }

    const result = await uploadProductToShopify(product, extras);

    const updated = await prisma.product.update({
      where: { id },
      data: {
        shopifyProductId: result.productId,
        shopifyVariantId: result.variantId,
        shopifyInventoryItemId: result.inventoryItemId,
        shopifyStatus: result.status,
        shopifyLastUploadedAt: new Date(),
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
      return jsonError(message, error.status >= 400 && error.status < 500 ? error.status : 502, error.details);
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
