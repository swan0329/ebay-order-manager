import type { ProductImageExtras } from "@/lib/ebay-listing-fields";
import { asErrorMessage, jsonError } from "@/lib/http";
import { reservedByProduct } from "@/lib/stock-reservation";
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

    // 아직 처리하지 않은 주문이 잡아 둔 몫을 빼고 올린다. 실재고를 올리면 이미
    // 팔린 카드가 쇼피파이에서 계속 팔린다.
    const reservedLines = await prisma.orderItem.findMany({
      where: { productId: id, stockDeducted: false },
      select: {
        productId: true,
        quantity: true,
        stockDeducted: true,
        order: { select: { orderStatus: true, fulfillmentStatus: true } },
      },
    });
    const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
    const reserved =
      reservedByProduct(
        reservedLines.map((line) => ({
          productId: line.productId as string,
          quantity: line.quantity,
          stockDeducted: line.stockDeducted,
          orderCancelled:
            cancelled.includes(line.order.orderStatus) ||
            cancelled.includes(line.order.fulfillmentStatus),
        })),
      ).get(id) ?? 0;

    const result = await uploadProductToShopify(product, extras, reserved);

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
