import type { EbayAccount } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import {
  accountHasScope,
  ebayApiRequest,
  getActiveEbayMarketingAccount,
  sellMarketingReadonlyScope,
  sellMarketingScope,
} from "@/lib/services/ebayApiService";

type CampaignRecord = Record<string, unknown>;

export type MarketingCampaignOption = {
  id: string;
  name: string;
  status: string;
  fundingModel: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function campaignIdFromLocation(location: string | null) {
  if (!location) {
    return null;
  }

  const parts = location.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function simplifyCampaign(campaign: CampaignRecord): MarketingCampaignOption | null {
  const id = text(campaign.campaignId);

  if (!id) {
    return null;
  }

  const fundingStrategy =
    campaign.fundingStrategy &&
    typeof campaign.fundingStrategy === "object" &&
    !Array.isArray(campaign.fundingStrategy)
      ? (campaign.fundingStrategy as Record<string, unknown>)
      : {};

  return {
    id,
    name: text(campaign.campaignName) || id,
    status: text(campaign.campaignStatus),
    fundingModel: text(fundingStrategy.fundingModel),
  };
}

export function marketingScopeSummary(account: Pick<EbayAccount, "scopes"> | null) {
  return {
    canReadMarketing: Boolean(
      account && accountHasScope(account as EbayAccount, sellMarketingReadonlyScope),
    ),
    canWriteMarketing: Boolean(
      account && accountHasScope(account as EbayAccount, sellMarketingScope),
    ),
  };
}

export async function getMarketingCampaigns(
  userId: string,
  marketplaceId = "EBAY_US",
) {
  const account = await getActiveEbayMarketingAccount(userId, false);
  const result = await ebayApiRequest(account, {
    path: "/sell/marketing/v1/ad_campaign",
    query: {
      campaign_status: "RUNNING",
      funding_strategy: "COST_PER_SALE",
      limit: 100,
    },
  });
  const body = result.body as { campaigns?: CampaignRecord[] } | null;
  const campaigns =
    body?.campaigns
      ?.map(simplifyCampaign)
      .filter((campaign): campaign is MarketingCampaignOption =>
        Boolean(campaign && (!marketplaceId || campaign)),
      ) ?? [];

  return campaigns;
}

export async function createPromotedCampaign(input: {
  userId: string;
  campaignName: string;
  marketplaceId?: string | null;
  adRate?: string | number | null;
  fundingModel?: string | null;
}) {
  const account = await getActiveEbayMarketingAccount(input.userId, true);
  const fundingModel = input.fundingModel?.trim() || "COST_PER_SALE";
  const bidPercentage = String(input.adRate ?? "2.0").trim() || "2.0";
  const result = await ebayApiRequest(account, {
    method: "POST",
    path: "/sell/marketing/v1/ad_campaign",
    body: {
      campaignName: input.campaignName.trim(),
      startDate: new Date().toISOString(),
      fundingStrategy: {
        fundingModel,
        ...(fundingModel === "COST_PER_SALE" ? { bidPercentage } : {}),
      },
      marketplaceId: input.marketplaceId?.trim() || "EBAY_US",
    },
  });
  const campaignId = campaignIdFromLocation(result.headers.get("location"));

  if (!campaignId) {
    throw new Error("eBay did not return a campaign id.");
  }

  return campaignId;
}

export async function addListingToPromotedCampaign(input: {
  userId: string;
  campaignId: string;
  listingId: string;
  adRate?: string | number | null;
}) {
  const account = await getActiveEbayMarketingAccount(input.userId, true);
  const body = {
    listingId: input.listingId,
    ...(input.adRate ? { bidPercentage: String(input.adRate) } : {}),
  };

  try {
    const result = await ebayApiRequest(account, {
      method: "POST",
      path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(
        input.campaignId,
      )}/ad`,
      body,
    });

    return {
      status: "active",
      location: result.headers.get("location"),
    };
  } catch (error) {
    if (error instanceof EbayApiError && error.status === 409) {
      return { status: "already_exists", location: null };
    }

    throw error;
  }
}
