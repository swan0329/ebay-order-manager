import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { planEbayInventoryPush } from "@/lib/services/ebayInventoryPush";
import { createEbayInventoryFeedTask, downloadEbayInventoryFeedResult, getEbayInventoryFeedStatus, uploadEbayInventoryFeedFile, type EbayInventoryFeedTarget } from "@/lib/services/ebayInventoryFeed";
import { listingReviseTarget } from "@/lib/services/ebayRevise";

const JOB_SOURCE = "ebay_inventory_change";
const ACTIVE = ["pending", "running"];
const MAX_FEED_ROWS = 2_000;
const STALE_UNSUBMITTED_MS = 2 * 60_000;
const TERMINAL_FAILURE = new Set(["FAILED", "CANCELED", "CANCELLED"]);

type StoredTarget = EbayInventoryFeedTarget & { productId: string; skuLabel: string; listingType: "SINGLE" | "VARIATION_OPTION" };
type JobPayload = { batchId: string; productId: string; action: "CHANGE" | "UNAVAILABLE"; taskId?: string; target?: StoredTarget };

function payload(raw: Prisma.JsonValue | null): JobPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.batchId !== "string" || typeof value.productId !== "string") return null;
  if (value.action !== "CHANGE" && value.action !== "UNAVAILABLE") return null;
  const target = value.target && typeof value.target === "object" && !Array.isArray(value.target) ? value.target as StoredTarget : undefined;
  return { batchId: value.batchId, productId: value.productId, action: value.action, taskId: typeof value.taskId === "string" ? value.taskId : undefined, target };
}

async function runTransactions(queries: Prisma.PrismaPromise<unknown>[], size = 100) {
  for (let offset = 0; offset < queries.length; offset += size) await prisma.$transaction(queries.slice(offset, offset + size));
}

export async function enqueueEbayInventoryJobs(input: { userId: string; productIds: string[]; action: "CHANGE" | "UNAVAILABLE" }) {
  const productIds = [...new Set(input.productIds)].slice(0, MAX_FEED_ROWS);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true } });
  const activeJobs = await prisma.productUploadJob.findMany({ where: { userId: input.userId, source: JOB_SOURCE, status: { in: ACTIVE } }, select: { rawJson: true } });
  const alreadyQueued = new Set(activeJobs.flatMap((job) => payload(job.rawJson)?.productId ?? []));
  const byId = new Map(products.map((product) => [product.id, product]));
  const batchId = randomUUID();
  const rows = productIds.flatMap((productId) => {
    const product = byId.get(productId);
    if (!product || alreadyQueued.has(productId)) return [];
    return [{ userId: input.userId, productId, sku: product.sku, source: JOB_SOURCE, action: input.action, status: "pending", message: "eBay 대량 파일 생성 대기", rawJson: { batchId, productId, action: input.action } }];
  });
  if (rows.length) await prisma.productUploadJob.createMany({ data: rows });
  return getEbayInventoryJobSummary(input.userId, rows.length ? batchId : undefined);
}

async function activeJobsForUser(userId: string) {
  return prisma.productUploadJob.findMany({ where: { userId, source: JOB_SOURCE, status: { in: ACTIVE } }, orderBy: { createdAt: "asc" }, take: MAX_FEED_ROWS });
}

async function finishFeed(userId: string, taskId: string, jobs: Awaited<ReturnType<typeof activeJobsForUser>>) {
  const task = await getEbayInventoryFeedStatus(userId, taskId);
  if (task.status === "CREATED") {
    const targets = jobs.flatMap((job) => {
      const target = payload(job.rawJson)?.target;
      return target ? [target] : [];
    });
    if (!targets.length) throw new Error("eBay 대량작업 파일을 다시 만들 대상 정보가 없습니다.");
    await uploadEbayInventoryFeedFile(userId, taskId, targets);
    await prisma.productUploadJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) }, status: "running" }, data: { message: `eBay 대량작업 접수 완료 · ${targets.length}건 결과 대기` } });
    return;
  }
  if (TERMINAL_FAILURE.has(task.status)) {
    const message = `eBay 대량작업이 ${task.status} 상태로 종료되었습니다.`;
    await prisma.productUploadJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) }, status: "running" }, data: { status: "failed", message: "eBay 대량작업 실패", error: message, errorSummary: message, finishedAt: new Date() } });
    return;
  }
  if (!["COMPLETED", "COMPLETED_WITH_ERROR", "PARTIALLY_PROCESSED"].includes(task.status)) {
    await prisma.productUploadJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) }, status: "running" }, data: { message: `eBay 처리 중 · 접수 ${jobs.length}건 · 현재 상태 ${task.status}` } });
    return;
  }

  const results = await downloadEbayInventoryFeedResult(userId, taskId);
  const byCorrelation = new Map(results.map((result) => [result.correlationId, result]));
  const queries: Prisma.PrismaPromise<unknown>[] = [];
  for (const job of jobs) {
    const value = payload(job.rawJson);
    const target = value?.target;
    const result = value ? byCorrelation.get(value.productId) : null;
    if (target && result?.success) {
      queries.push(prisma.productListing.upsert({
        where: { productId_channel: { productId: target.productId, channel: "EBAY" } },
        update: { externalId: target.itemId, quantity: target.quantity, ...(target.price == null ? {} : { price: target.price }), metadata: { listingType: target.listingType, sku: target.skuLabel, feedTaskId: taskId } },
        create: { productId: target.productId, channel: "EBAY", externalId: target.itemId, quantity: target.quantity, price: target.price, status: "ACTIVE", metadata: { listingType: target.listingType, sku: target.skuLabel, feedTaskId: taskId } },
      }));
      queries.push(prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "success", message: "eBay 대량작업 결과 파일에서 반영 성공 확인", error: null, errorSummary: null, finishedAt: new Date(), finalPayloadJson: target } }));
    } else {
      const message = result?.message ?? "eBay 결과 파일에서 이 항목의 처리 결과를 찾지 못했습니다.";
      queries.push(prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", message: "eBay 대량작업 반영 실패", error: message, errorSummary: message, finishedAt: new Date() } }));
    }
  }
  await runTransactions(queries);
}

export async function processEbayInventoryJobs(userId: string) {
  let active = await activeJobsForUser(userId);
  const submitted = active.filter((job) => payload(job.rawJson)?.taskId);
  if (submitted.length) {
    const taskId = payload(submitted[0].rawJson)!.taskId!;
    await finishFeed(userId, taskId, submitted.filter((job) => payload(job.rawJson)?.taskId === taskId));
    return getEbayInventoryJobSummary(userId);
  }

  const staleIds = active.filter((job) => job.status === "running" && job.startedAt && job.startedAt.getTime() < Date.now() - STALE_UNSUBMITTED_MS).map((job) => job.id);
  if (staleIds.length) {
    await prisma.productUploadJob.updateMany({ where: { id: { in: staleIds }, status: "running" }, data: { status: "pending", message: "중단된 기존 개별 전송을 대량 파일 방식으로 전환", startedAt: null } });
    active = await activeJobsForUser(userId);
  }
  if (active.some((job) => job.status === "running")) return getEbayInventoryJobSummary(userId);

  const first = active.find((job) => job.status === "pending");
  const batchId = first ? payload(first.rawJson)?.batchId : null;
  if (!batchId) return getEbayInventoryJobSummary(userId);
  const candidates = active.filter((job) => job.status === "pending" && payload(job.rawJson)?.batchId === batchId);
  const claimed = await prisma.productUploadJob.updateMany({ where: { id: { in: candidates.map((job) => job.id) }, status: "pending" }, data: { status: "running", message: "eBay 대량 파일 생성·업로드 중", startedAt: new Date(), error: null, errorSummary: null } });
  if (claimed.count !== candidates.length) return getEbayInventoryJobSummary(userId);

  let createdTaskId: string | null = null;
  try {
    const productIds = candidates.flatMap((job) => job.productId ? [job.productId] : []);
    const plan = await planEbayInventoryPush({ productIds, userId });
    const rowByProduct = new Map(plan.rows.filter((row) => row.actionable).map((row) => [row.productId, row]));
    const targets: StoredTarget[] = [];
    const invalidQueries: Prisma.PrismaPromise<unknown>[] = [];
    for (const job of candidates) {
      const row = job.productId ? rowByProduct.get(job.productId) : null;
      if (!row) {
        const message = "실행 시점에 활성 eBay 연결 또는 판매 가능한 최신 재고값을 찾지 못했습니다.";
        invalidQueries.push(prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", message: "대량작업 전 자동 검증 실패", error: message, errorSummary: message, finishedAt: new Date() } }));
        continue;
      }
      const revise = listingReviseTarget({ itemId: row.itemId, sku: row.sku, listingType: row.listingType, quantity: row.quantity, price: row.price });
      targets.push({ correlationId: row.productId, productId: row.productId, itemId: row.itemId, sku: revise.sku ?? null, skuLabel: row.sku, listingType: row.listingType, quantity: row.quantity, price: row.price });
    }
    if (invalidQueries.length) await runTransactions(invalidQueries);
    if (!targets.length) return getEbayInventoryJobSummary(userId);
    const targetByProduct = new Map(targets.map((target) => [target.productId, target]));
    await runTransactions(candidates.flatMap((job) => {
      const target = job.productId ? targetByProduct.get(job.productId) : null;
      const value = payload(job.rawJson);
      if (!target || !value) return [];
      return [prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "running", message: "eBay 대량파일 대상 확정 · 작업번호 생성 대기", rawJson: { ...value, target } } })];
    }));
    const taskId = await createEbayInventoryFeedTask(userId);
    createdTaskId = taskId;
    await runTransactions(candidates.flatMap((job) => {
      const value = payload(job.rawJson);
      const target = job.productId ? targetByProduct.get(job.productId) : null;
      if (!value || !target) return [];
      return [prisma.productUploadJob.update({ where: { id: job.id }, data: { message: "eBay 작업번호 저장 완료 · 파일 업로드 중", rawJson: { ...value, taskId, target } } })];
    }));
    await uploadEbayInventoryFeedFile(userId, taskId, targets);
    await prisma.productUploadJob.updateMany({ where: { id: { in: candidates.map((job) => job.id) }, status: "running" }, data: { message: `eBay 대량작업 접수 완료 · ${targets.length}건 결과 대기` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "eBay 가격·재고 대량작업 제출 실패";
    if (createdTaskId) {
      // 업로드 응답을 받지 못했어도 eBay가 파일을 접수했을 수 있다. 실패로 단정하거나 새 작업을
      // 중복 제출하지 않고, 저장된 작업 번호를 다음 요청에서 먼저 조회한다.
      await prisma.productUploadJob.updateMany({ where: { id: { in: candidates.map((job) => job.id) }, status: "running" }, data: { message: "eBay 접수 상태 재확인 대기", error: message, errorSummary: message } });
    } else {
      await prisma.productUploadJob.updateMany({ where: { id: { in: candidates.map((job) => job.id) }, status: "running" }, data: { status: "failed", message: "eBay 대량작업 제출 실패", error: message, errorSummary: message, finishedAt: new Date() } });
    }
  }
  return getEbayInventoryJobSummary(userId);
}

export async function getEbayInventoryJobSummary(userId: string, requestedBatchId?: string) {
  const jobs = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE }, orderBy: { createdAt: "desc" }, take: 2_500,
    select: { id: true, productId: true, sku: true, action: true, status: true, message: true, errorSummary: true, rawJson: true, createdAt: true, startedAt: true, finishedAt: true },
  });
  const active = jobs.filter((job) => ACTIVE.includes(job.status));
  const latestBatchId = requestedBatchId ?? active.map((job) => payload(job.rawJson)?.batchId).find(Boolean) ?? jobs.map((job) => payload(job.rawJson)?.batchId).find(Boolean) ?? null;
  const batch = latestBatchId ? jobs.filter((job) => payload(job.rawJson)?.batchId === latestBatchId) : [];
  const succeeded = batch.filter((job) => job.status === "success").length;
  const failed = batch.filter((job) => job.status === "failed").length;
  const submitted = batch.filter((job) => payload(job.rawJson)?.taskId).length;
  const taskId = batch.map((job) => payload(job.rawJson)?.taskId).find(Boolean) ?? null;
  return {
    kind: "inventory" as const, batchId: latestBatchId, taskId, active: active.length,
    pending: active.filter((job) => job.status === "pending").length,
    running: active.filter((job) => job.status === "running").length,
    submitted, succeeded, failed, completed: succeeded + failed, total: batch.length,
    stage: active.length ? submitted ? "EBAY_PROCESSING" : "PREPARING" : failed ? "COMPLETED_WITH_ERROR" : "COMPLETED",
    jobs: batch.map((job) => ({ id: job.id, productId: job.productId, sku: job.sku, action: job.action, status: job.status, message: job.message, errorSummary: job.errorSummary, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt })),
  };
}
