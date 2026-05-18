import { asErrorMessage, jsonError } from "@/lib/http";
import {
  createPromotedCampaign,
  getMarketingCampaigns,
} from "@/lib/services/ebayMarketingService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const marketplaceId = url.searchParams.get("marketplaceId") || "EBAY_US";
    const campaigns = await getMarketingCampaigns(user.id, marketplaceId);

    return Response.json({ campaigns });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = (await request.json().catch(() => null)) as
      | {
          campaignName?: string;
          marketplaceId?: string;
          adRate?: string | number | null;
          fundingModel?: string | null;
        }
      | null;
    const campaignName = input?.campaignName?.trim();

    if (!campaignName) {
      return jsonError("campaignName is required.", 422);
    }

    const campaignId = await createPromotedCampaign({
      userId: user.id,
      campaignName,
      marketplaceId: input?.marketplaceId,
      adRate: input?.adRate,
      fundingModel: input?.fundingModel,
    });

    return Response.json({ campaignId });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
