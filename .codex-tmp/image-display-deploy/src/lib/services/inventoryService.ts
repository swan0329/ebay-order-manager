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
  conditionDescription?: string | null;
  listingDuration?: string | null;
  listingFormat?: string | null;
  shippingProfile: string;
  returnProfile: string;
  paymentProfile?: string | null;
  merchantLocationKey?: string | null;
  marketplaceId?: string | null;
  currency?: string | null;
  shippingService?: string | null;
  handlingTime?: number | null;
  internationalShippingEnabled?: boolean | null;
  excludedLocations?: string[];
  bestOfferEnabled?: boolean | null;
  minimumOfferPrice?: string | null;
  autoAcceptPrice?: string | null;
  privateListing?: boolean | null;
  immediatePayRequired?: boolean | null;
  promotedListingEnabled?: boolean | null;
  promotedCampaignId?: string | null;
  promotedAdRate?: string | number | null;
  promotedFundingModel?: string | null;
  itemSpecifics?: Record<string, string[]>;
  brand?: string | null;
  type?: string | null;
  countryOfOrigin?: string | null;
  customLabel?: string | null;
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
  // A listing quantity is not a receipt of physical stock; USD is not KRW cost.
  const data: Prisma.ProductUncheckedUpdateInput = {
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

    return { product, created: false };
  }

  const product = await prisma.product.create({
    data: {
      sku: input.sku,
      productName: input.title,
      salePrice: null,
      stockQuantity: 0,
      ...(createdBy ? { finalListingPriceUsd: input.price, finalListingPriceSource: "MANUAL_USD",
        finalListingPriceApprovedById: createdBy, finalListingPriceApprovedAt: new Date(),
        listingPriceApprovals: { create: { priceUsd: input.price, source: "MANUAL_USD", approvedById: createdBy } },
      } : {}),
      safetyStock: 0,
      imageUrl: firstImageUrl(input.imageUrls),
      status: "sold_out",
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

  return { product, created: true };
}
