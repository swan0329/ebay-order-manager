import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export type ListingUploadInput = {
  sku: string;
  title: string;
  descriptionHtml: string;
  price: string;
  quantity: number;
  imageUrls: string[];
  categoryId: string;
  condition: string;
  shippingProfile: string;
  returnProfile: string;
  paymentProfile?: string | null;
  merchantLocationKey?: string | null;
  marketplaceId?: string | null;
  currency?: string | null;
};

function nullableText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function firstImageUrl(imageUrls: string[]) {
  return imageUrls.find((url) => url.trim()) ?? null;
}

export async function upsertProductFromListingInput(
  input: ListingUploadInput,
  createdBy?: string | null,
) {
  const current = await prisma.product.findUnique({
    where: { sku: input.sku },
    select: { id: true, stockQuantity: true },
  });
  const data: Prisma.ProductUncheckedUpdateInput = {
    productName: input.title,
    salePrice: input.price,
    stockQuantity: input.quantity,
    imageUrl: firstImageUrl(input.imageUrls),
    status: input.quantity > 0 ? "active" : "sold_out",
    ebayTitle: input.title,
    descriptionHtml: input.descriptionHtml,
    ebayPrice: input.price,
    ebayImageUrls: input.imageUrls,
    ebayCategoryId: input.categoryId,
    ebayCondition: input.condition,
    ebayShippingProfile: input.shippingProfile,
    ebayReturnProfile: input.returnProfile,
    ebayPaymentProfile: nullableText(input.paymentProfile),
    ebayMerchantLocationKey: nullableText(input.merchantLocationKey),
    ebayMarketplaceId: input.marketplaceId ?? "EBAY_US",
    ebayCurrency: input.currency ?? "USD",
  };

  if (current) {
    const product = await prisma.product.update({
      where: { id: current.id },
      data,
    });

    if (current.stockQuantity !== input.quantity) {
      await prisma.inventoryMovement.create({
        data: {
          productId: product.id,
          type: "ADJUST",
          quantity: Math.abs(input.quantity - current.stockQuantity),
          beforeQuantity: current.stockQuantity,
          afterQuantity: input.quantity,
          reason: "eBay 상품 업로드",
          createdBy,
        },
      });
    }

    return { product, created: false };
  }

  const product = await prisma.product.create({
    data: {
      sku: input.sku,
      productName: input.title,
      salePrice: input.price,
      stockQuantity: input.quantity,
      safetyStock: 0,
      imageUrl: firstImageUrl(input.imageUrls),
      status: input.quantity > 0 ? "active" : "sold_out",
      ebayTitle: input.title,
      descriptionHtml: input.descriptionHtml,
      ebayPrice: input.price,
      ebayImageUrls: input.imageUrls,
      ebayCategoryId: input.categoryId,
      ebayCondition: input.condition,
      ebayShippingProfile: input.shippingProfile,
      ebayReturnProfile: input.returnProfile,
      ebayPaymentProfile: nullableText(input.paymentProfile),
      ebayMerchantLocationKey: nullableText(input.merchantLocationKey),
      ebayMarketplaceId: input.marketplaceId ?? "EBAY_US",
      ebayCurrency: input.currency ?? "USD",
    },
  });

  if (input.quantity > 0) {
    await prisma.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "IN",
        quantity: input.quantity,
        beforeQuantity: 0,
        afterQuantity: input.quantity,
        reason: "eBay 상품 업로드",
        createdBy,
      },
    });
  }

  return { product, created: true };
}
