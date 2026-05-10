import { Prisma } from "@/generated/prisma";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import { getSellerListingPolicies } from "@/lib/services/listingPolicyService";

type CachedPolicy = {
  id: string;
  name: string;
  marketplaceId: string;
};

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

async function cachePolicies(
  userId: string,
  policyType: "payment" | "fulfillment" | "return",
  policies: CachedPolicy[],
) {
  for (const policy of policies) {
    await prisma.ebayPolicyCache.upsert({
      where: {
        userId_policyType_policyId_marketplaceId: {
          userId,
          policyType,
          policyId: policy.id,
          marketplaceId: policy.marketplaceId,
        },
      },
      update: {
        name: policy.name || policy.id,
        rawJson: toJson(policy),
      },
      create: {
        userId,
        policyType,
        policyId: policy.id,
        name: policy.name || policy.id,
        marketplaceId: policy.marketplaceId,
        rawJson: toJson(policy),
      },
    });
  }
}

export async function syncPolicies(userId: string, marketplaceId = "EBAY_US") {
  const policies = await getSellerListingPolicies(userId, marketplaceId);

  await cachePolicies(userId, "payment", policies.paymentPolicies);
  await cachePolicies(userId, "fulfillment", policies.fulfillmentPolicies);
  await cachePolicies(userId, "return", policies.returnPolicies);

  for (const location of policies.inventoryLocations) {
    await prisma.ebayInventoryLocationCache.upsert({
      where: {
        userId_merchantLocationKey: {
          userId,
          merchantLocationKey: location.id,
        },
      },
      update: {
        name: location.name || location.id,
        addressSummary: location.status || null,
        rawJson: toJson(location),
      },
      create: {
        userId,
        merchantLocationKey: location.id,
        name: location.name || location.id,
        addressSummary: location.status || null,
        rawJson: toJson(location),
      },
    });
  }

  return policies;
}

export async function getCachedPolicies(userId: string) {
  const [policies, locations] = await Promise.all([
    prisma.ebayPolicyCache.findMany({
      where: { userId },
      orderBy: [{ policyType: "asc" }, { name: "asc" }],
    }),
    prisma.ebayInventoryLocationCache.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    }),
  ]);

  return { policies, locations };
}

export async function getEbayConnectionSummary(userId: string) {
  const account = await prisma.ebayAccount.findFirst({
    where: { userId, environment: currentEbayEnvironment() },
    orderBy: { updatedAt: "desc" },
    select: {
      environment: true,
      username: true,
      ebayUserId: true,
      scopes: true,
      updatedAt: true,
    },
  });

  return {
    expectedEnvironment: currentEbayEnvironment(),
    environment: account?.environment ?? null,
    username: account?.username ?? account?.ebayUserId ?? null,
    scopes: account?.scopes ?? "",
    connected: Boolean(account),
  };
}
