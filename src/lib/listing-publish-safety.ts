import type { Product } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { refreshProcurementProduct } from "@/lib/procurement-refresh";
import { resolveListingPriceUsd, type ListingPriceSettings } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import type { ListingUploadInput } from "@/lib/services/inventoryService";

export function assertListingPublishValues(product: Product, input: ListingUploadInput, settings?: ListingPriceSettings) {
  if (input.sku !== product.sku || (input.currency ?? "USD") !== "USD") throw new Error("상품 SKU와 USD 통화를 확인해야 등록할 수 있습니다.");
  const minimum = resolveListingPriceUsd(product, settings)?.priceUsd;
  const price = Number(input.price);
  if (!minimum || !Number.isFinite(price) || minimum.greaterThan(price)) {
    throw new Error("등록 가격이 현재 원가 기준 판매가보다 낮거나 원가·승인가를 확인할 수 없습니다. 가격을 다시 확인해 주세요.");
  }
  const quantity = listingQuantity(product);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || !Number.isFinite(quantity) || input.quantity > quantity) {
    throw new Error("등록 수량이 현재 보유·조달 가능 수량을 초과하거나 판매 가능 재고가 없습니다.");
  }
  if (input.bestOfferEnabled && (!input.minimumOfferPrice || minimum.greaterThan(input.minimumOfferPrice) ||
    (input.autoAcceptPrice != null && minimum.greaterThan(input.autoAcceptPrice)))) {
    throw new Error("가격 제안의 최저 허용금액도 현재 원가 기준 판매가 이상이어야 합니다.");
  }
}

// The final external-write boundary, shared by drafts, manual uploads, Excel,
// and retries. Earlier preview validation cannot guarantee a queued price.
export async function assertListingPublishSafety(product: Product, input: ListingUploadInput) {
  const current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  const fresh = await refreshProcurementProduct(current);
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  assertListingPublishValues(fresh, input, settings ?? undefined);
}
