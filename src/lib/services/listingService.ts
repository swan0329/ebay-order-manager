import type { EbayAccount, Product } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import {
  buildEbayListingDescription,
  buildEbayListingImageUrls,
  buildEbayListingItemSpecificArrays,
  buildEbayListingItemSpecifics,
  buildEbayListingTitle,
} from "@/lib/ebay-listing-fields";
import { ebayApiRequest } from "@/lib/services/ebayApiService";
import type { ListingUploadInput } from "@/lib/services/inventoryService";

type ListingOffer = {
  offerId?: string;
  listing?: {
    listingId?: string;
    listingStatus?: string;
  };
};

export type ListingUploadResult = {
  action: "create" | "revise";
  offerId: string | null;
  listingId: string | null;
  listingStatus: string;
};

function envValue(...names: string[]) {
  return names.map((name) => process.env[name]?.trim()).find(Boolean) ?? null;
}

function textFromHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredValue(value: string | null | undefined, label: string) {
  const text = value?.trim();

  if (!text) {
    throw new Error(`${label} 값이 필요합니다.`);
  }

  return text;
}

function priceString(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

function amount(currency: string, value?: string | null) {
  if (!value) {
    return undefined;
  }

  return { currency, value };
}

function cleanObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  ) as T;
}

export function productToListingInput(product: Product): ListingUploadInput {
  const imageUrls = buildEbayListingImageUrls(product);
  const title = buildEbayListingTitle(product);
  const descriptionHtml = buildEbayListingDescription(product);
  const itemSpecifics = buildEbayListingItemSpecifics(product);

  return {
    sku: product.sku,
    title,
    descriptionHtml,
    price: requiredValue(
      priceString(product.ebayPrice ?? product.salePrice),
      "price",
    ),
    quantity: product.stockQuantity,
    imageUrls,
    categoryId: requiredValue(product.ebayCategoryId, "category_id"),
    condition: product.ebayCondition ?? "NEW",
    shippingProfile: requiredValue(
      product.ebayShippingProfile ??
        envValue("EBAY_SHIPPING_POLICY_ID", "EBAY_FULFILLMENT_POLICY_ID"),
      "shipping_profile",
    ),
    returnProfile: requiredValue(
      product.ebayReturnProfile ?? envValue("EBAY_RETURN_POLICY_ID"),
      "return_profile",
    ),
    paymentProfile:
      product.ebayPaymentProfile ?? envValue("EBAY_PAYMENT_POLICY_ID"),
    merchantLocationKey:
      product.ebayMerchantLocationKey ?? envValue("EBAY_MERCHANT_LOCATION_KEY"),
    marketplaceId:
      product.ebayMarketplaceId ?? envValue("EBAY_MARKETPLACE_ID") ?? "EBAY_US",
    currency: product.ebayCurrency ?? envValue("EBAY_CURRENCY") ?? "USD",
    listingFormat: "FIXED_PRICE",
    brand: itemSpecifics.Brand || product.brand,
    type: itemSpecifics.Type,
    countryOfOrigin: itemSpecifics["Country/Region of Manufacture"],
    itemSpecifics: buildEbayListingItemSpecificArrays(product),
  };
}

export function inventoryItemPayload(input: ListingUploadInput) {
  if (!input.imageUrls.length) {
    throw new Error("image_urls 값이 필요합니다.");
  }

  const aspects: Record<string, string[]> = {
    Type: ["Photocard"],
    ...(input.itemSpecifics ?? {}),
  };

  if (input.brand) {
    aspects.Brand = [input.brand];
  }

  if (input.type) {
    aspects.Type = [input.type];
  }

  if (input.countryOfOrigin) {
    aspects.Country = [input.countryOfOrigin];
  }

  if (input.customLabel) {
    aspects["Custom Label"] = [input.customLabel];
  }

  return cleanObject({
    availability: {
      shipToLocationAvailability: {
        quantity: input.quantity,
      },
    },
    condition: input.condition,
    conditionDescription: input.conditionDescription || undefined,
    product: {
      title: input.title,
      description: textFromHtml(input.descriptionHtml) || input.title,
      imageUrls: input.imageUrls,
      aspects,
    },
  });
}

export function offerPayload(input: ListingUploadInput) {
  const paymentProfile = requiredValue(input.paymentProfile, "payment_profile");
  const merchantLocationKey = requiredValue(
    input.merchantLocationKey,
    "merchant_location_key",
  );
  const marketplaceId = input.marketplaceId ?? "EBAY_US";
  const currency = input.currency ?? "USD";
  const bestOfferTerms =
    input.bestOfferEnabled || input.minimumOfferPrice || input.autoAcceptPrice
      ? cleanObject({
          bestOfferEnabled: Boolean(input.bestOfferEnabled),
          autoDeclinePrice: amount(currency, input.minimumOfferPrice),
          autoAcceptPrice: amount(currency, input.autoAcceptPrice),
        })
      : undefined;

  return cleanObject({
    sku: input.sku,
    marketplaceId,
    format: input.listingFormat ?? "FIXED_PRICE",
    listingDuration: input.listingDuration || undefined,
    hideBuyerDetails: input.privateListing || undefined,
    includeCatalogProductDetails: false,
    availableQuantity: input.quantity,
    categoryId: input.categoryId,
    merchantLocationKey,
    listingDescription: input.descriptionHtml,
    listingPolicies: {
      bestOfferTerms,
      fulfillmentPolicyId: input.shippingProfile,
      paymentPolicyId: paymentProfile,
      returnPolicyId: input.returnProfile,
    },
    pricingSummary: {
      price: {
        currency,
        value: input.price,
      },
    },
  });
}

export function buildListingPayloadPreview(input: ListingUploadInput) {
  return {
    sku: input.sku,
    inventoryItem: inventoryItemPayload(input),
    offer: offerPayload(input),
    finalValues: {
      title: input.title,
      sku: input.sku,
      price: input.price,
      quantity: input.quantity,
      categoryId: input.categoryId,
      condition: input.condition,
      marketplaceId: input.marketplaceId ?? "EBAY_US",
      currency: input.currency ?? "USD",
      listingFormat: input.listingFormat ?? "FIXED_PRICE",
      listingDuration: input.listingDuration ?? null,
      paymentPolicyId: input.paymentProfile ?? null,
      fulfillmentPolicyId: input.shippingProfile,
      returnPolicyId: input.returnProfile,
      merchantLocationKey: input.merchantLocationKey ?? null,
      imageUrls: input.imageUrls,
      itemSpecifics: input.itemSpecifics ?? {},
      descriptionHtml: input.descriptionHtml,
      bestOfferEnabled: Boolean(input.bestOfferEnabled),
      privateListing: Boolean(input.privateListing),
      promotedListingEnabled: Boolean(input.promotedListingEnabled),
      promotedCampaignId: input.promotedCampaignId ?? null,
      promotedAdRate: input.promotedAdRate ?? null,
    },
  };
}

async function getExistingOffer(
  account: EbayAccount,
  sku: string,
  marketplaceId: string,
) {
  const result = await ebayApiRequest(account, {
    path: "/sell/inventory/v1/offer",
    query: {
      sku,
      marketplace_id: marketplaceId,
      format: "FIXED_PRICE",
    },
  });
  const body = result.body as { offers?: ListingOffer[] } | null;

  return body?.offers?.[0] ?? null;
}

async function createOrReplaceInventoryItem(
  account: EbayAccount,
  input: ListingUploadInput,
) {
  await ebayApiRequest(account, {
    method: "PUT",
    path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`,
    body: inventoryItemPayload(input),
    contentLanguage: "en-US",
  });
}

async function createOffer(account: EbayAccount, input: ListingUploadInput) {
  const result = await ebayApiRequest(account, {
    method: "POST",
    path: "/sell/inventory/v1/offer",
    body: offerPayload(input),
    contentLanguage: "en-US",
  });
  const body = result.body as { offerId?: string } | null;

  return requiredValue(body?.offerId, "offerId");
}

async function updateOffer(
  account: EbayAccount,
  offerId: string,
  input: ListingUploadInput,
) {
  try {
    await ebayApiRequest(account, {
      method: "PUT",
      path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
      body: offerPayload(input),
      contentLanguage: "en-US",
    });
    return true;
  } catch (error) {
    if (error instanceof EbayApiError && error.status === 404) {
      return false;
    }

    throw error;
  }
}

async function publishOffer(account: EbayAccount, offerId: string) {
  const result = await ebayApiRequest(account, {
    method: "POST",
    path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
  });
  const body = result.body as { listingId?: string } | null;

  return requiredValue(body?.listingId, "listingId");
}

export async function publishProductListing(
  account: EbayAccount,
  product: Product,
  inputOverride?: ListingUploadInput,
): Promise<ListingUploadResult> {
  const input = inputOverride ?? productToListingInput(product);
  await createOrReplaceInventoryItem(account, input);

  let offerId = product.ebayOfferId;
  if (!offerId) {
    offerId = (await getExistingOffer(account, input.sku, input.marketplaceId ?? "EBAY_US"))?.offerId ?? null;
  }
  if (offerId && !(await updateOffer(account, offerId, input))) offerId = null;
  if (!offerId) offerId = await createOffer(account, input);

  // 이미 게시된 Item ID가 있으면 publish를 다시 호출해 중복 게시하지 않는다.
  if (product.ebayItemId) {
    return { action: "revise", offerId, listingId: product.ebayItemId, listingStatus: "ACTIVE" };
  }
  const listingId = await publishOffer(account, offerId);
  return { action: "create", offerId, listingId, listingStatus: "ACTIVE" };
}
