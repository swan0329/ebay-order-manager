import {
  accountHasScope,
  ebayApiRequest,
  getActiveEbayAccountPolicyAccount,
  sellInventoryScope,
} from "@/lib/services/ebayApiService";

type PolicyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function simplifyPolicy(policy: PolicyRecord, idKey: string) {
  return {
    id: text(policy[idKey]),
    name: text(policy.name),
    marketplaceId: text(policy.marketplaceId),
    description: text(policy.description),
  };
}

function simplifyLocation(location: PolicyRecord) {
  return {
    id: text(location.merchantLocationKey),
    name: text(location.name) || text(location.merchantLocationKey),
    status: text(location.locationStatus),
    type: text(location.locationTypes),
  };
}

export async function getSellerListingPolicies(userId: string, marketplaceId = "EBAY_US") {
  const account = await getActiveEbayAccountPolicyAccount(userId);
  const locationRequest = accountHasScope(account, sellInventoryScope)
    ? ebayApiRequest(account, {
        path: "/sell/inventory/v1/location",
      })
    : Promise.resolve(null);
  const [payment, fulfillment, returns, locations] = await Promise.all([
    ebayApiRequest(account, {
      path: "/sell/account/v1/payment_policy",
      query: { marketplace_id: marketplaceId },
      contentLanguage: "en-US",
    }),
    ebayApiRequest(account, {
      path: "/sell/account/v1/fulfillment_policy",
      query: { marketplace_id: marketplaceId },
      contentLanguage: "en-US",
    }),
    ebayApiRequest(account, {
      path: "/sell/account/v1/return_policy",
      query: { marketplace_id: marketplaceId },
      contentLanguage: "en-US",
    }),
    locationRequest,
  ]);

  const paymentBody = payment.body as { paymentPolicies?: PolicyRecord[] } | null;
  const fulfillmentBody = fulfillment.body as { fulfillmentPolicies?: PolicyRecord[] } | null;
  const returnBody = returns.body as { returnPolicies?: PolicyRecord[] } | null;
  const locationBody = locations?.body as { locations?: PolicyRecord[] } | null;

  return {
    marketplaceId,
    inventoryLocationsSkipped: !locations,
    paymentPolicies:
      paymentBody?.paymentPolicies?.map((policy) =>
        simplifyPolicy(policy, "paymentPolicyId"),
      ) ?? [],
    fulfillmentPolicies:
      fulfillmentBody?.fulfillmentPolicies?.map((policy) =>
        simplifyPolicy(policy, "fulfillmentPolicyId"),
      ) ?? [],
    returnPolicies:
      returnBody?.returnPolicies?.map((policy) =>
        simplifyPolicy(policy, "returnPolicyId"),
      ) ?? [],
    inventoryLocations: locationBody?.locations?.map(simplifyLocation) ?? [],
  };
}
