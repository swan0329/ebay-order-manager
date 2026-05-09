import { Prisma } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { publishProductListing } from "@/lib/services/listingService";

function errorMessage(error: unknown) {
  if (error instanceof EbayApiError) {
    return JSON.stringify({ status: error.status, body: error.body });
  }

  return error instanceof Error ? error.message : "Unknown upload error";
}

function toInputJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export async function createUploadJob(input: {
  userId: string;
  productId: string;
  sku: string;
  source: string;
  rawJson?: unknown;
}) {
  return prisma.productUploadJob.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      sku: input.sku,
      source: input.source,
      status: "pending",
      rawJson: input.rawJson === undefined ? undefined : toInputJson(input.rawJson),
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
    },
  });

  try {
    const account = await getActiveEbayInventoryAccount(job.userId);
    const result = await publishProductListing(account, job.product);
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
      },
    });

    return { job: updatedJob, result };
  } catch (error) {
    const message = errorMessage(error);
    const now = new Date();

    await prisma.product.update({
      where: { id: job.product.id },
      data: {
        listingStatus: "FAILED",
        uploadError: message,
      },
    });
    const updatedJob = await prisma.productUploadJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error: message,
        finishedAt: now,
      },
    });

    return { job: updatedJob, error: message };
  }
}

export async function processProductUpload(input: {
  userId: string;
  productId: string;
  sku: string;
  source: string;
  rawJson?: unknown;
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
      rawJson: { retryOf: job.id },
    });
    results.push(await processUploadJob(retryJob.id));
  }

  return results;
}
