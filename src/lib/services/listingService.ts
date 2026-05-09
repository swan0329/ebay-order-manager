import type { EbayAccount, Product } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
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

export function productToListingInput(product: Product): ListingUploadInput {
  const imageUrls = product.ebayImageUrls.length
    ? product.ebayImageUrls
    : product.imageUrl
      ? [product.imageUrl]
      : [];
  const title = product.ebayTitle ?? product.productName;
  const descriptionHtml =
    product.descriptionHtml ??
    product.memo ??
    `<p>${title.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] ?? char)}</p>`;

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
  };
}

function inventoryItemPayload(input: ListingUploadInput) {
  if (!input.imageUrls.length) {
    throw new Error("image_urls 값이 필요합니다.");
  }

  return {
    availability: {
      shipToLocationAvailability: {
        quantity: input.quantity,
      },
    },
    condition: input.condition,
    product: {
      title: input.title,
      description: textFromHtml(input.descriptionHtml) || input.title,
      imageUrls: input.imageUrls,
      aspects: {
        Type: ["Photocard"],
      },
    },
  };
}

function offerPayload(input: ListingUploadInput) {
  const paymentProfile = requiredValue(input.paymentProfile, "payment_profile");
  const merchantLocationKey = requiredValue(
    input.merchantLocationKey,
    "merchant_location_key",
  );
  const marketplaceId = input.marketplaceId ?? "EBAY_US";
  const currency = input.currency ?? "USD";

  return {
    sku: input.sku,
    marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: input.quantity,
    categoryId: input.categoryId,
    merchantLocationKey,
    listingDescription: input.descriptionHtml,
    listingPolicies: {
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
): Promise<ListingUploadResult> {
  const input = productToListingInput(product);
  const marketplaceId = input.marketplaceId ?? "EBAY_US";

  await createOrReplaceInventoryItem(account, input);

  const existingOffer = await getExistingOffer(account, input.sku, marketplaceId);
  const existingOfferId = existingOffer?.offerId ?? product.ebayOfferId;
  const action = existingOfferId ? "revise" : "create";
  let offerId = existingOfferId ?? null;
  let listingId = existingOffer?.listing?.listingId ?? product.ebayItemId ?? null;
  let listingStatus = existingOffer?.listing?.listingStatus ?? "UNPUBLISHED";

  if (offerId) {
    const updated = await updateOffer(account, offerId, input);

    if (!updated) {
      offerId = await createOffer(account, input);
      listingId = null;
      listingStatus = "UNPUBLISHED";
    }
  } else {
    offerId = await createOffer(account, input);
  }

  if (!listingId && offerId) {
    listingId = await publishOffer(account, offerId);
    listingStatus = "ACTIVE";
  } else if (listingId) {
    listingStatus = listingStatus === "UNPUBLISHED" ? "ACTIVE" : listingStatus;
  }

  return {
    action,
    offerId,
    listingId,
    listingStatus,
  };
}
