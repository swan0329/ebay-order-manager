import "server-only";
import { coalesceInFlightRead } from "@/lib/in-flight-read";

import { getShopifyAutomaticOperationProductIds } from "@/lib/channel-publish-jobs";
import { getEbayFeedOperationTargets } from "@/lib/ebay-feed-operations";
import { getRegistrationCandidates, type RegistrationBreakdown } from "@/lib/channel-registration-candidates";
import type { ProductSalesChannel } from "@/lib/product-operations";
import { getEbayVariationMembershipByProductId } from "@/lib/variation-listing-products";

async function registrationCount(channel: ProductSalesChannel) {
  return getRegistrationCandidates(channel, 1);
}

export type ChannelOperationCounts = {
  ebay: { register: number; registrationBreakdown: RegistrationBreakdown; revise: number; end: number; revisePrice: number; reviseQuantity: number; reviseUnverified: number };
  shopify: { register: number; registrationBreakdown: RegistrationBreakdown; revise: number; end: number };
};

async function readChannelOperationCounts(
  userId: string,
): Promise<ChannelOperationCounts> {
  const [
    variationMembership,
    ebayRegister,
    shopifyRegister,
    shopifyRevise,
    shopifyEnd,
  ] = await Promise.all([
    getEbayVariationMembershipByProductId(userId),
    registrationCount("EBAY"),
    registrationCount("SHOPIFY"),
    getShopifyAutomaticOperationProductIds("revise"),
    getShopifyAutomaticOperationProductIds("end"),
  ]);
  const [ebayRevise, ebayEnd] = await Promise.all([
    getEbayFeedOperationTargets(userId, "revise", undefined, variationMembership),
    getEbayFeedOperationTargets(userId, "end", undefined, variationMembership),
  ]);

  return {
    ebay: {
      register: ebayRegister.eligibleCount,
      registrationBreakdown: ebayRegister.breakdown,
      revise: ebayRevise.length,
      end: ebayEnd.length,
      revisePrice: ebayRevise.filter((target) => target.priceChanged).length,
      reviseQuantity: ebayRevise.filter((target) => target.quantityChanged).length,
      reviseUnverified: ebayRevise.filter((target) => target.verificationMissing).length,
    },
    shopify: {
      register: shopifyRegister.eligibleCount,
      registrationBreakdown: shopifyRegister.breakdown,
      revise: shopifyRevise.length,
      end: shopifyEnd.length,
    },
  };
}

export const getChannelOperationCounts = coalesceInFlightRead(readChannelOperationCounts);
