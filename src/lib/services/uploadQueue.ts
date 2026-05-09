import { Prisma } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import type { ListingUploadInput } from "@/lib/services/inventoryService";
import { buildListingPayloadPreview, publishProductListing } from "@/lib/services/listingService";
import { listingUploadSchema } from "@/lib/services/listingUploadInput";

function rawErrorMessage(error: unknown) {
  if (error instanceof EbayApiError) {
    return JSON.stringify({ status: error.status, body: error.body });
  }

  return error instanceof Error ? error.message : "Unknown upload error";
}

function errorSummary(error: unknown) {
  if (!(error instanceof EbayApiError)) {
    return error instanceof Error ? error.message : "알 수 없는 업로드 오류입니다.";
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

function ebayErrorJson(error: unknown) {
  if (error instanceof EbayApiError) {
    return { status: error.status, body: error.body };
  }

  return undefined;
}

function toInputJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function finalInputFromJob(value: Prisma.JsonValue | null): ListingUploadInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const finalInput = (value as Record<string, unknown>).finalInput;

  if (!finalInput) {
    return undefined;
  }

  return listingUploadSchema.parse(finalInput);
}

function payloadJson(finalInput?: ListingUploadInput) {
  if (!finalInput) {
    return undefined;
  }

  return {
    finalInput,
    preview: buildListingPayloadPreview(finalInput),
  };
}

export async function createUploadJob(input: {
  userId: string;
  productId: string;
  sku: string;
  source: string;
  templateId?: string | null;
  rawJson?: unknown;
  finalInput?: ListingUploadInput;
}) {
  return prisma.productUploadJob.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      templateId: input.templateId ?? null,
      sku: input.sku,
      source: input.source,
      status: "pending",
      rawJson: input.rawJson === undefined ? undefined : toInputJson(input.rawJson),
      finalPayloadJson:
        input.finalInput === undefined ? undefined : toInputJson(payloadJson(input.finalInput)),
    },
  });
}

export async function processUploadJob(jobId: string) {
  const job = await prisma.productUploadJob.findUnique({
    where: { id: jobId },
    include: { product: true },
  });

  if (!job || !job.product) {
    throw new Error("업로드 작업 또는 상품을 찾을 수 없습니다.");
  }

  await prisma.productUploadJob.update({
    where: { id: job.id },
    data: {
      status: "running",
      startedAt: new Date(),
      error: null,
      errorSummary: null,
      rawEbayError: Prisma.JsonNull,
    },
  });

  try {
    const account = await getActiveEbayInventoryAccount(job.userId);
    const result = await publishProductListing(
      account,
      job.product,
      finalInputFromJob(job.finalPayloadJson),
    );
    const now = new Date();

    await prisma.product.update({
      where: { id: job.product.id },
      data: {
        ebayOfferId: result.offerId,
        ebayItemId: result.listingId,
        listingStatus: result.listingStatus,
        lastUploadedAt: now,
        uploadError: null,
      },
    });
    const updatedJob = await prisma.productUploadJob.update({
      where: { id: job.id },
      data: {
        action: result.action,
        status: "success",
        message: `${result.action} ${result.listingId ?? result.offerId ?? ""}`.trim(),
        finishedAt: now,
        error: null,
        errorSummary: null,
        rawEbayError: Prisma.JsonNull,
      },
    });

    return { job: updatedJob, result };
  } catch (error) {
    const raw = rawErrorMessage(error);
    const summary = errorSummary(error);
    const rawEbayError = ebayErrorJson(error);
    const now = new Date();

    await prisma.product.update({
      where: { id: job.product.id },
      data: {
        listingStatus: "FAILED",
        uploadError: summary,
      },
    });
    const updatedJob = await prisma.productUploadJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error: raw,
        errorSummary: summary,
        rawEbayError: rawEbayError ? toInputJson(rawEbayError) : Prisma.JsonNull,
        finishedAt: now,
      },
    });

    return { job: updatedJob, error: summary, rawError: raw };
  }
}

export async function processProductUpload(input: {
  userId: string;
  productId: string;
  sku: string;
  source: string;
  templateId?: string | null;
  rawJson?: unknown;
  finalInput?: ListingUploadInput;
}) {
  const job = await createUploadJob(input);
  return processUploadJob(job.id);
}

export async function retryFailedUploadJobs(userId: string, limit = 20) {
  const jobs = await prisma.productUploadJob.findMany({
    where: { userId, status: "failed", productId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const results = [];

  for (const job of jobs) {
    const retryJob = await createUploadJob({
      userId,
      productId: job.productId as string,
      sku: job.sku,
      source: "retry",
      templateId: job.templateId,
      rawJson: { retryOf: job.id },
      finalInput: finalInputFromJob(job.finalPayloadJson),
    });
    results.push(await processUploadJob(retryJob.id));
  }

  return results;
}
