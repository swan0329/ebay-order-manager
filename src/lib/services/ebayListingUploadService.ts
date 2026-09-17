import { resolveListingPriceUsd } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import { refreshProcurementProduct } from "@/lib/procurement-refresh";
import { Prisma, type ListingDraft } from "@/generated/prisma";
import { z } from "zod";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { addListingToPromotedCampaign } from "@/lib/services/ebayMarketingService";
import { upsertProductFromListingInput } from "@/lib/services/inventoryService";
import { draftToListingInput } from "@/lib/services/listingDraftService";
import { publishProductListing } from "@/lib/services/listingService";
import { validateListingUploadInput } from "@/lib/services/listingValidationService";
import { prepareProductChannelImages } from "@/lib/listing-source-images";

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function ebayErrorJson(error: unknown) {
  if (error instanceof EbayApiError) {
    return { status: error.status, body: error.body };
  }

  return undefined;
}

function errorSummary(error: unknown) {
  if (!(error instanceof EbayApiError)) {
    return error instanceof Error ? error.message : "업로드 오류입니다.";
  }

  const body = error.body;

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const errors = Array.isArray(record.errors) ? record.errors : [];
    const first = errors.find(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
    const message =
      String(record.message ?? "").trim() ||
      String(record.error_description ?? "").trim() ||
      String(record.error ?? "").trim() ||
      String(first?.message ?? "").trim() ||
      String(first?.longMessage ?? "").trim();

    if (message) {
      return `eBay 오류: ${message}`;
    }
  }

  return `eBay 오류: HTTP ${error.status}`;
}

function draftInputErrorSummary(error: unknown) {
  if (!(error instanceof z.ZodError)) return errorSummary(error);
  const labels: Record<string, string> = {
    price: "판매가격",
    categoryId: "eBay 카테고리",
    shippingProfile: "배송정책",
    returnProfile: "반품정책",
    paymentProfile: "결제정책",
    merchantLocationKey: "eBay 재고 위치",
  };
  const fields = [...new Set(error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "input");
    return labels[field] ?? field;
  }))];
  return `eBay 등록 필수값을 자동으로 정하지 못했습니다: ${fields.join(", ")}`;
}

async function upsertListingLink(input: {
  inventoryId: string | null;
  sku: string;
  offerId: string | null;
  ebayItemId: string | null;
  listingStatus: string | null;
}) {
  if (!input.inventoryId) {
    return null;
  }

  return prisma.inventoryListingLink.upsert({
    where: { inventoryId: input.inventoryId },
    update: {
      sku: input.sku,
      offerId: input.offerId,
      ebayItemId: input.ebayItemId,
      listingStatus: input.listingStatus,
      lastUploadedAt: new Date(),
      lastSyncedAt: new Date(),
    },
    create: {
      inventoryId: input.inventoryId,
      sku: input.sku,
      offerId: input.offerId,
      ebayItemId: input.ebayItemId,
      listingStatus: input.listingStatus,
      lastUploadedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });
}

export async function uploadDraft(userId: string, draft: ListingDraft) {
  let input;
  let sourcePrimaryImageUrl: string | null = null;
  try {
    let refreshedSource;
    if (draft.sourceInventoryId) {
      const source = await prisma.product.findUnique({ where: { id: draft.sourceInventoryId } });
      if (source) refreshedSource = await refreshProcurementProduct(source, userId);
    }
    input = await draftToListingInput(userId, draft);
    if (refreshedSource) {
      const price = resolveListingPriceUsd(refreshedSource, await prisma.pricingSettings.findUnique({ where: { id: "default" } }) ?? undefined);
      const quantity = price ? listingQuantity(refreshedSource) : 0;
      if (!price || quantity <= 0) throw new Error("포카마켓 가격·수량을 확인하지 못했거나 조달 재고가 없어 신규등록을 보류합니다.");
      input.price = price.priceUsd.toFixed(2);
      input.quantity = quantity;
    }
    if (draft.sourceInventoryId) {
      const sourceProduct = await prisma.product.findUnique({
        where: { id: draft.sourceInventoryId },
        select: {
          id: true,
          sku: true,
          imageUrl: true,
          ebayImageUrls: true,
          shopifyProductId: true,
        },
      });
      if (sourceProduct) {
        const preparedProduct = await prepareProductChannelImages(userId, sourceProduct);
        const channelReadyImages = preparedProduct.ebayImageUrls;
        if (channelReadyImages.length) input.imageUrls = [...new Set(channelReadyImages)];
        sourcePrimaryImageUrl = sourceProduct.imageUrl;
      }
    }
  } catch (error) {
    const summary = draftInputErrorSummary(error);
    await prisma.listingDraft.update({
      where: { id: draft.id },
      data: {
        status: "failed",
        errorSummary: summary,
        rawErrorJson: Prisma.JsonNull,
      },
    });
    return { draftId: draft.id, error: summary };
  }
  const validation = await validateListingUploadInput(input, {
    userId,
    checkImageUrls: true,
    checkOAuthScope: true,
    checkCategoryAspects: true,
  });

  if (!validation.valid) {
    const summary = validation.issues.map((issue) => issue.message).join(" / ");
    await prisma.listingDraft.update({
      where: { id: draft.id },
      data: {
        status: "failed",
        errorSummary: summary,
        validationJson: toJson(validation),
      },
    });
    return { draftId: draft.id, error: summary, validation };
  }

  await prisma.listingDraft.update({
    where: { id: draft.id },
    data: {
      status: "uploading",
      errorSummary: null,
      rawErrorJson: Prisma.JsonNull,
      validationJson: toJson(validation),
    },
  });

  try {
    const account = await getActiveEbayInventoryAccount(userId);
    const { product } = await upsertProductFromListingInput(input, userId);
    const result = await publishProductListing(account, product, input);
    const now = new Date();
    let promotedStatus: string | null = null;
    let promotedErrorSummary: string | null = null;

    if (draft.promotedListingEnabled) {
      if (!result.listingId) {
        promotedStatus = "failed";
        promotedErrorSummary = "Promoted Listings requires a published listing ID.";
      } else if (!draft.promotedCampaignId) {
        promotedStatus = "failed";
        promotedErrorSummary = "Promoted campaign is not selected.";
      } else {
        try {
          const promoted = await addListingToPromotedCampaign({
            userId,
            campaignId: draft.promotedCampaignId,
            listingId: result.listingId,
            adRate: draft.promotedAdRate?.toString() ?? null,
          });
          promotedStatus = promoted.status;
        } catch (error) {
          promotedStatus = "failed";
          promotedErrorSummary = errorSummary(error);
        }
      }
    }

    await prisma.listingDraft.update({
      where: { id: draft.id },
      data: {
        status: "uploaded",
        ebayItemId: result.listingId,
        offerId: result.offerId,
        listingStatus: result.listingStatus,
        promotedStatus,
        promotedErrorSummary,
        lastUploadedAt: now,
        errorSummary: null,
        rawErrorJson: Prisma.JsonNull,
      },
    });
    await upsertListingLink({
      inventoryId: draft.sourceInventoryId ?? product.id,
      sku: input.sku,
      offerId: result.offerId,
      ebayItemId: result.listingId,
      listingStatus: result.listingStatus,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: {
        ebayOfferId: result.offerId,
        ebayItemId: result.listingId,
        listingStatus: result.listingStatus,
        lastUploadedAt: now,
        ebayLastSyncedPrice: input.price,
        ebayLastSyncedQuantity: input.quantity,
        imageUrl: sourcePrimaryImageUrl ?? undefined,
        uploadError: null,
        uploadErrorSummary: null,
        uploadRawError: Prisma.JsonNull,
      },
    });

    return { draftId: draft.id, result, promotedStatus, promotedErrorSummary };
  } catch (error) {
    const summary = errorSummary(error);
    const raw = ebayErrorJson(error);
    await prisma.listingDraft.update({
      where: { id: draft.id },
      data: {
        status: "failed",
        errorSummary: summary,
        rawErrorJson: raw ? toJson(raw) : Prisma.JsonNull,
      },
    });
    return { draftId: draft.id, error: summary, rawError: raw };
  }
}

export async function uploadDrafts(userId: string, ids: string[]) {
  const drafts = await prisma.listingDraft.findMany({
    where: { userId, id: { in: ids } },
  });
  const results = new Array<Awaited<ReturnType<typeof uploadDraft>>>(drafts.length);
  let nextIndex = 0;
  const workerCount = Math.min(3, drafts.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < drafts.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await uploadDraft(userId, drafts[index]);
      }
    }),
  );

  return results;
}

export async function retryFailedDrafts(userId: string) {
  const drafts = await prisma.listingDraft.findMany({
    where: { userId, status: "failed" },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return uploadDrafts(
    userId,
    drafts.map((draft) => draft.id),
  );
}
