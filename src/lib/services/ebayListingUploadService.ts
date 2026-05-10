import { Prisma, type ListingDraft } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { upsertProductFromListingInput } from "@/lib/services/inventoryService";
import { draftToListingInput } from "@/lib/services/listingDraftService";
import { publishProductListing } from "@/lib/services/listingService";
import { validateListingUploadInput } from "@/lib/services/listingValidationService";

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
  const input = await draftToListingInput(userId, draft);
  const validation = await validateListingUploadInput(input, {
    userId,
    checkImageUrls: true,
    checkOAuthScope: true,
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

    await prisma.listingDraft.update({
      where: { id: draft.id },
      data: {
        status: "uploaded",
        ebayItemId: result.listingId,
        offerId: result.offerId,
        listingStatus: result.listingStatus,
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
        uploadError: null,
        uploadErrorSummary: null,
        uploadRawError: Prisma.JsonNull,
      },
    });

    return { draftId: draft.id, result };
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
  const results = [];

  for (const draft of drafts) {
    results.push(await uploadDraft(userId, draft));
  }

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
