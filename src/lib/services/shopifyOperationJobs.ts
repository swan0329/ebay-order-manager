import "server-only";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getShopifyOperations } from "@/lib/services/ebayOperations";
import { repairShopifyProductImages } from "@/lib/services/shopifyImageRepair";
import { uploadShopifyProduct } from "@/lib/services/shopifyProductUpload";
import { uploadShopifyVariationGroup } from "@/lib/services/shopifyVariationUpload";

const JOB_SOURCE = "shopify_operations";
const ACTIVE = ["pending", "running"];
const IMAGE_REPAIR_RECOVERY_DELAY_MS = 2 * 60_000;
type Action = "CREATE" | "CHANGE" | "UNAVAILABLE" | "IMAGE_REPAIR";

type JobPayload = { batchId?: string; productIds?: string[]; targetId?: string };

function payload(value: Prisma.JsonValue | null): JobPayload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JobPayload : {};
}

function sourceForAction(operations: Awaited<ReturnType<typeof getShopifyOperations>>, action: Action) {
  return action === "CREATE" ? operations.create
    : action === "CHANGE" ? operations.change
      : action === "UNAVAILABLE" ? operations.unavailable
        : operations.imageRepair;
}

/**
 * Shopify writes may take minutes while media is copied and variant links are
 * checked.  Persist them before doing I/O so navigating away can never turn a
 * completed write into an unknown result in the browser.
 */
export async function enqueueShopifyOperationJobs(input: { userId: string; action: Action; targets: Array<{ targetId: string; productIds: string[]; sku: string }> }) {
  const active = await prisma.productUploadJob.findFirst({ where: { userId: input.userId, source: JOB_SOURCE, status: { in: ACTIVE } }, select: { id: true } });
  if (active) throw new Error("이미 Shopify 작업이 진행 중입니다. 완료 후 다음 작업을 시작해 주세요.");
  const batchId = crypto.randomUUID();
  await prisma.productUploadJob.createMany({ data: input.targets.map((target) => ({
    userId: input.userId,
    // 묶음의 targetId는 가상 ID이므로 FK에는 실제 단품일 때만 저장한다.
    productId: target.productIds.length === 1 ? target.productIds[0] : null,
    sku: target.sku,
    source: JOB_SOURCE,
    action: input.action,
    status: "pending",
    message: "Shopify 작업 대기",
    rawJson: { batchId, productIds: target.productIds, targetId: target.targetId },
  })) });
  return getShopifyOperationJobSummary(input.userId, batchId);
}

export async function processShopifyOperationJobs(userId: string, limit = 100) {
  // 신규등록/가격 변경은 외부 생성 직후 응답이 끊기면 중복 게시 위험이 있으므로
  // 실행 중 상태를 자동 재개하지 않는다. 반면 이미지 교체는 같은 미디어 연결을
  // 재조회하는 멱등 작업이므로, 2분을 넘긴 작업만 대기로 돌려 다음 상태 조회에서
  // 안전하게 다시 확인한다. 28분처럼 큐 전체가 멈추는 상태를 막는다.
  await prisma.productUploadJob.updateMany({
    where: { userId, source: JOB_SOURCE, action: "IMAGE_REPAIR", status: "running", startedAt: { lt: new Date(Date.now() - IMAGE_REPAIR_RECOVERY_DELAY_MS) } },
    data: { status: "pending", startedAt: null, message: "2분 제한 초과 · Shopify 이미지 상태 재확인 재개" },
  });
  // 이 수정 전에는 Shopify의 "이미 연결됨" 응답을 실패로 기록했다. 해당 과거
  // 이미지 작업만 새 멱등 검증 경로로 한 번 되돌린다. 신규등록·가격·재고 실패는
  // 절대 자동 재시도하지 않는다.
  await prisma.productUploadJob.updateMany({
    where: { userId, source: JOB_SOURCE, action: "IMAGE_REPAIR", status: "failed", errorSummary: { contains: "given variant already has attached media", mode: "insensitive" } },
    data: { status: "pending", startedAt: null, finishedAt: null, error: null, errorSummary: null, message: "기존 옵션 사진 연결을 Shopify 재조회로 재검증" },
  });
  const jobs = await prisma.productUploadJob.findMany({ where: { userId, source: JOB_SOURCE, status: "pending" }, orderBy: { createdAt: "asc" }, take: limit });
  for (const job of jobs) {
    const claimed = await prisma.productUploadJob.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "running", startedAt: new Date(), error: null, errorSummary: null, message: "Shopify 최신 상태 확인 중" } });
    if (!claimed.count) continue;
    try {
      const action = job.action as Action;
      const data = payload(job.rawJson);
      const operations = await getShopifyOperations();
      const row = sourceForAction(operations, action).find((candidate) => String(candidate.productId) === data.targetId);
      // 이미 다른 작업으로 목표 값이 반영되어 목록에서 사라진 경우다. 외부에 다시
      // 쓰지 않고 완료로 확정한다.
      if (!row) {
        await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "success", message: "최신 목록에서 완료 상태 확인", finishedAt: new Date() } });
        continue;
      }
      const productIds = data.productIds ?? [];
      if (!productIds.length) throw new Error("Shopify 작업 대상 상품을 확인하지 못했습니다.");
      const result = action === "IMAGE_REPAIR"
        ? await repairShopifyProductImages(productIds, userId)
        : productIds.length > 1
          ? await uploadShopifyVariationGroup(productIds, userId)
          : await uploadShopifyProduct(productIds[0], userId);
      const partialFailures = "failed" in result && Array.isArray(result.failed) ? result.failed : [];
      if (partialFailures.length) throw new Error(partialFailures.map((failure: { sku: string; reason: string }) => `${failure.sku}: ${failure.reason}`).join(" / "));
      // upload/repair services verify Shopify's returned price, inventory and
      // media IDs before updating ProductListing metadata. Re-read the target
      // list once: only a vanished target is called "actually reflected".
      const rechecked = await getShopifyOperations();
      const remains = sourceForAction(rechecked, action).some((candidate) => String(candidate.productId) === data.targetId);
      if (remains) throw new Error("Shopify 응답은 받았지만 최신 작업 목록에서 완료 상태를 확인하지 못했습니다.");
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "success", message: "Shopify 실제 반영 및 최신 목록 제외 확인 완료", finishedAt: new Date(), finalPayloadJson: result as Prisma.InputJsonValue } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shopify 작업 실패";
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", message: "Shopify 실제 반영 미확인", error: message, errorSummary: message, finishedAt: new Date() } });
    }
  }
  return getShopifyOperationJobSummary(userId);
}

/** Shopify 변경 없이 현재 대표·옵션 사진 연결만 다시 확인한다. */
export async function reconcileShopifyImageRepairJobs(userId: string, targetIds?: string[]) {
  const operations = await getShopifyOperations();
  const candidates = operations.imageRepair.filter((row) => row.actionable && (!targetIds || targetIds.includes(String(row.productId))));
  const outcomes: Array<{ productId: string; sku: string; current: boolean; reason: string }> = [];
  for (const row of candidates) {
    try {
      const result = await repairShopifyProductImages(row.productIds, userId, { verifyOnly: true });
      outcomes.push({
        productId: String(row.productId), sku: row.sku, current: "reconciled" in result && result.reconciled === true,
        reason: "reconciled" in result && result.reconciled === true ? "Shopify 실제 대표·옵션 사진 연결 확인 완료" : ("missing" in result ? (result.missing ?? []).join(" / ") : "현재 Shopify 사진 연결을 확인하지 못했습니다."),
      });
    } catch (error) {
      outcomes.push({ productId: String(row.productId), sku: row.sku, current: false, reason: error instanceof Error ? error.message : "Shopify 사진 재확인 실패" });
    }
  }
  const completedIds = new Set(outcomes.filter((outcome) => outcome.current).map((outcome) => outcome.productId));
  if (completedIds.size) {
    const jobs = await prisma.productUploadJob.findMany({
      where: { userId, source: JOB_SOURCE, action: "IMAGE_REPAIR", status: { in: ACTIVE.concat("failed") } },
      select: { id: true, rawJson: true },
    });
    for (const job of jobs) {
      if (!completedIds.has(String(payload(job.rawJson).targetId))) continue;
      await prisma.productUploadJob.update({
        where: { id: job.id },
        data: { status: "success", message: "Shopify 실제 사진 연결 재확인 완료", error: null, errorSummary: null, finishedAt: new Date() },
      });
    }
  }
  const latest = await getShopifyOperations();
  return { checked: candidates.length, completed: completedIds.size, remaining: latest.imageRepair.length, outcomes, operations: latest, job: await getShopifyOperationJobSummary(userId) };
}

export async function getShopifyOperationJobSummary(userId: string, requestedBatchId?: string) {
  const jobs = await prisma.productUploadJob.findMany({ where: { userId, source: JOB_SOURCE }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, productId: true, sku: true, action: true, status: true, message: true, errorSummary: true, rawJson: true, createdAt: true, startedAt: true, finishedAt: true } });
  const active = jobs.filter((job) => ACTIVE.includes(job.status));
  const batchId = requestedBatchId ?? active.map((job) => payload(job.rawJson).batchId).find(Boolean) ?? jobs.map((job) => payload(job.rawJson).batchId).find(Boolean) ?? null;
  const batch = batchId ? jobs.filter((job) => payload(job.rawJson).batchId === batchId) : [];
  const succeeded = batch.filter((job) => job.status === "success").length;
  const failed = batch.filter((job) => job.status === "failed").length;
  return {
    kind: "shopify" as const, batchId, active: active.length,
    pending: active.filter((job) => job.status === "pending").length,
    running: active.filter((job) => job.status === "running").length,
    succeeded, failed, completed: succeeded + failed, total: batch.length,
    jobs: batch.map((job) => ({ id: job.id, productId: job.productId, targetId: payload(job.rawJson).targetId ?? null, productIds: payload(job.rawJson).productIds ?? [], sku: job.sku, action: job.action, status: job.status, message: job.message, errorSummary: job.errorSummary, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt })),
  };
}
