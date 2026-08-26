import "server-only";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getShopifyOperations } from "@/lib/services/ebayOperations";
import { repairShopifyProductImages } from "@/lib/services/shopifyImageRepair";
import { uploadShopifyProduct } from "@/lib/services/shopifyProductUpload";
import { uploadShopifyVariationGroup } from "@/lib/services/shopifyVariationUpload";
import { reconcileShopifyPriceInventory, syncShopifyPriceInventory } from "@/lib/services/shopifyInventoryOperations";
import { findShopifyProductVariantsBySkus } from "@/lib/services/shopifyService";

const JOB_SOURCE = "shopify_operations";
const ACTIVE = ["pending", "running"];
const RECOVERABLE_JOB_DELAY_MS = 2 * 60_000;
const CREATE_RECOVERY_DELAY_MS = 6 * 60_000;
const MAX_CONCURRENT_JOBS = 2;
type Action = "CREATE" | "CHANGE" | "UNAVAILABLE" | "IMAGE_REPAIR";

type JobPayload = { batchId?: string; productIds?: string[]; targetId?: string };

function payload(value: Prisma.JsonValue | null): JobPayload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JobPayload : {};
}

function publicJobError(message: string | null) {
  if (!message) return null;
  return message.includes("Timed out fetching a new connection") || message.includes("connection pool timeout")
    ? "내부 데이터 연결이 혼잡해 작업을 확인하지 못했습니다. 이 항목만 다시 시도해 주세요."
    : message;
}

function isTransientWorkerContention(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "P2024" || code === "P2028";
}

function sourceForAction(operations: Awaited<ReturnType<typeof getShopifyOperations>>, action: Action) {
  return action === "CREATE" ? operations.create
    : action === "CHANGE" ? operations.change
      : action === "UNAVAILABLE" ? operations.unavailable
        : operations.imageRepair;
}

async function recoverStaleCreateJobs(userId: string) {
  const stale = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE, action: "CREATE", status: "running", startedAt: { lt: new Date(Date.now() - CREATE_RECOVERY_DELAY_MS) } },
    orderBy: { startedAt: "asc" }, take: MAX_CONCURRENT_JOBS,
  });
  for (const job of stale) {
    const claimedAt = new Date();
    const claimed = await prisma.productUploadJob.updateMany({
      where: { id: job.id, status: "running", startedAt: job.startedAt },
      data: { startedAt: claimedAt, message: "제한시간 초과 · Shopify 동일 SKU 생성 여부 확인 중" },
    });
    if (!claimed.count) continue;
    try {
      const data = payload(job.rawJson);
      const products = await prisma.product.findMany({ where: { id: { in: data.productIds ?? [] } }, select: { id: true, sku: true } });
      if (!products.length) throw new Error("내부 Shopify 작업 대상 상품을 찾지 못했습니다.");
      const found = await findShopifyProductVariantsBySkus(products.map((product) => product.sku));
      const bySku = new Map(found.map((variant) => [variant.sku, variant]));
      if (!found.length) {
        await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "pending", startedAt: null, message: "Shopify 동일 SKU 상품 없음 확인 · 안전 재시작 대기" } });
        continue;
      }
      const productIds = new Set(found.map((variant) => variant.productId));
      if (products.some((product) => !bySku.has(product.sku)) || productIds.size !== 1) {
        const message = "Shopify에서 일부 SKU만 발견되거나 서로 다른 상품에 연결되어 자동 재시작하지 않습니다.";
        await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", message: "Shopify 부분 생성 확인 · 수동 확인 필요", error: message, errorSummary: message, finishedAt: new Date() } });
        continue;
      }
      const externalId = found[0].productId;
      await prisma.$transaction(products.flatMap((product) => {
        const variant = bySku.get(product.sku)!;
        return [
          prisma.product.update({ where: { id: product.id }, data: { shopifyProductId: externalId, shopifyVariantId: variant.variantId, shopifyInventoryItemId: variant.inventoryItemId, shopifyStatus: variant.productStatus, shopifyLastUploadedAt: new Date() } }),
          prisma.productListing.upsert({ where: { productId_channel: { productId: product.id, channel: "SHOPIFY" } }, update: { externalId, price: variant.price, quantity: variant.inventoryQuantity, status: variant.productStatus, metadata: { source: "shopify_stale_create_recovery", variantId: variant.variantId, inventoryItemId: variant.inventoryItemId } }, create: { productId: product.id, channel: "SHOPIFY", externalId, price: variant.price, quantity: variant.inventoryQuantity, status: variant.productStatus, metadata: { source: "shopify_stale_create_recovery", variantId: variant.variantId, inventoryItemId: variant.inventoryItemId } } }),
        ];
      }));
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "pending", startedAt: null, message: "Shopify 기존 생성 상품 연결 복구 · 나머지 반영 재개 대기" } });
    } catch (error) {
      const message = publicJobError(error instanceof Error ? error.message : "Shopify 생성 여부 확인 실패") ?? "Shopify 생성 여부 확인 실패";
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "running", startedAt: claimedAt, message, errorSummary: message } });
    }
  }
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

export async function processShopifyOperationJobs(userId: string, limit = MAX_CONCURRENT_JOBS) {
  await recoverStaleCreateJobs(userId);
  // 신규등록은 외부 생성 직후 응답이 끊기면 중복 게시 위험이 있어 자동 재개하지
  // 않는다. 이미지와 가격·재고 전용 작업은 실제값 재확인을 포함한 멱등 경로이므로
  // 2분 넘게 멈춘 건만 대기로 돌려 다음 상태 조회에서 안전하게 재개한다.
  await prisma.productUploadJob.updateMany({
    where: { userId, source: JOB_SOURCE, action: { in: ["IMAGE_REPAIR", "CHANGE", "UNAVAILABLE"] }, status: "running", startedAt: { lt: new Date(Date.now() - RECOVERABLE_JOB_DELAY_MS) } },
    data: { status: "pending", startedAt: null, message: "2분 제한 초과 · Shopify 실제상태 재확인 재개" },
  });
  // 이 수정 전에는 Shopify의 "이미 연결됨" 응답을 실패로 기록했다. 해당 과거
  // 이미지 작업만 새 멱등 검증 경로로 한 번 되돌린다. 신규등록·가격·재고 실패는
  // 절대 자동 재시도하지 않는다.
  await prisma.productUploadJob.updateMany({
    where: { userId, source: JOB_SOURCE, action: "IMAGE_REPAIR", status: "failed", errorSummary: { contains: "given variant already has attached media", mode: "insensitive" } },
    data: { status: "pending", startedAt: null, finishedAt: null, error: null, errorSummary: null, message: "기존 옵션 사진 연결을 Shopify 재조회로 재검증" },
  });
  // 2026-08-26 배포 전 VerifyVariantMedia 문장의 닫는 괄호 누락으로 상품·재고가
  // 정상 생성된 뒤 마지막 옵션 사진 재조회만 실패했다. 생성된 외부 ID는 이미
  // 저장되어 있으므로 이 정확한 과거 오류만 기존 상품 수정 경로로 자동 재개한다.
  await prisma.productUploadJob.updateMany({
    where: {
      userId, source: JOB_SOURCE, action: "CREATE", status: "failed",
      OR: [
        { errorSummary: { contains: "Shopify VerifyVariantMedia 요청에 실패했습니다. syntax error, unexpected end of file" } },
        { errorSummary: { endsWith: "상품 이미지·썸네일 연결 실패: Shopify GraphQL 상품 요청에 실패했습니다." } },
      ],
    },
    data: { status: "pending", startedAt: null, finishedAt: null, error: null, errorSummary: null, message: "수정된 옵션 사진 확인으로 자동 재시작 대기" },
  });
  // 상태 폴링과 최초 after()가 겹쳐도 짧은 트랜잭션 advisory lock 안에서만
  // 작업을 가져온다. 외부 Shopify 호출 중에는 DB 연결과 lock을 잡지 않는다.
  const runningBeforeClaim = await prisma.productUploadJob.count({ where: { userId, source: JOB_SOURCE, status: "running" } });
  if (runningBeforeClaim >= MAX_CONCURRENT_JOBS) return getShopifyOperationJobSummary(userId);
  let jobs;
  try {
    jobs = await prisma.$transaction(async (tx) => {
      // PostgreSQL advisory lock 함수는 void를 반환한다. Prisma/Postgres 어댑터는
      // void 열을 역직렬화할 수 없으므로 짧은 lock 결과를 text로 명시한다.
      await tx.$queryRaw<Array<{ lock: string }>>`SELECT pg_advisory_xact_lock(hashtext(${`shopify-operations:${userId}`}))::text AS "lock"`;
      const running = await tx.productUploadJob.count({ where: { userId, source: JOB_SOURCE, status: "running" } });
      const take = Math.max(0, Math.min(limit, MAX_CONCURRENT_JOBS - running));
      if (!take) return [];
      const pending = await tx.productUploadJob.findMany({ where: { userId, source: JOB_SOURCE, status: "pending" }, orderBy: { createdAt: "asc" }, take });
      const claimed = [];
      for (const job of pending) {
        const result = await tx.productUploadJob.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "running", startedAt: new Date(), error: null, errorSummary: null, message: "Shopify 전송 및 실제 반영 확인 중" } });
        if (result.count) claimed.push(job);
      }
      return claimed;
    }, { timeout: 10_000 });
  } catch (error) {
    // 다른 폴러가 먼저 슬롯을 가져간 짧은 경합은 실패가 아니다. 다음 상태
    // 조회가 다시 깨우므로 오류 로그와 사용자 실패 건수를 만들지 않는다.
    if (isTransientWorkerContention(error)) return getShopifyOperationJobSummary(userId);
    throw error;
  }

  await Promise.all(jobs.map(async (job) => {
    try {
      const action = job.action as Action;
      const data = payload(job.rawJson);
      const productIds = data.productIds ?? [];
      if (!productIds.length) throw new Error("Shopify 작업 대상 상품을 확인하지 못했습니다.");
      const result = action === "IMAGE_REPAIR"
        ? await repairShopifyProductImages(productIds, userId)
        : action === "CHANGE" || action === "UNAVAILABLE"
          ? await syncShopifyPriceInventory(productIds, action)
          : productIds.length > 1
            ? await uploadShopifyVariationGroup(productIds, userId)
            : await uploadShopifyProduct(productIds[0], userId);
      const partialFailures = "failed" in result && Array.isArray(result.failed) ? result.failed : [];
      if (partialFailures.length) throw new Error(partialFailures.map((failure: { sku: string; reason: string }) => `${failure.sku}: ${failure.reason}`).join(" / "));
      await prisma.productUploadJob.update({ where: { id: job.id }, data: {
        status: "success",
        message: "Shopify 실제 반영 확인 완료",
        finishedAt: new Date(), finalPayloadJson: result as Prisma.InputJsonValue,
      } });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Shopify 작업 실패";
      const message = publicJobError(rawMessage) ?? "Shopify 작업 실패";
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", message: "Shopify 실제 반영 미확인", error: message, errorSummary: message, finishedAt: new Date() } });
    }
  }));
  return getShopifyOperationJobSummary(userId);
}

export async function reconcileShopifyInventoryJobs(userId: string, action: "CHANGE" | "UNAVAILABLE", targetIds: string[]) {
  const operations = await getShopifyOperations();
  const source = sourceForAction(operations, action);
  const selected = source.filter((row) => targetIds.includes(String(row.productId)));
  const outcomes = [];
  for (const row of selected) {
    const productIds = Array.isArray(row.productIds) ? row.productIds.filter((id): id is string => typeof id === "string") : [];
    if (!productIds.length) {
      outcomes.push({ productId: String(row.productId), sku: row.sku, current: false, reason: "내부 Shopify 상품 연결 대상을 찾지 못했습니다." });
      continue;
    }
    const checked = await reconcileShopifyPriceInventory(productIds, action);
    const current = checked.every((item) => item.current);
    outcomes.push({ productId: String(row.productId), sku: row.sku, current, reason: checked.map((item) => `${item.sku}: ${item.reason}`).join(" / ") });
  }
  const completedIds = new Set(outcomes.filter((outcome) => outcome.current).map((outcome) => outcome.productId));
  if (completedIds.size) {
    const jobs = await prisma.productUploadJob.findMany({
      where: { userId, source: JOB_SOURCE, action, status: { in: ["pending", "running", "failed"] } },
      select: { id: true, rawJson: true },
    });
    for (const job of jobs) {
      if (!completedIds.has(String(payload(job.rawJson).targetId))) continue;
      await prisma.productUploadJob.update({
        where: { id: job.id },
        data: { status: "success", message: "Shopify 실제 가격·재고 재확인 완료", error: null, errorSummary: null, finishedAt: new Date() },
      });
    }
  }
  const latest = await getShopifyOperations();
  return { checked: selected.length, completed: completedIds.size, outcomes, operations: latest, job: await getShopifyOperationJobSummary(userId) };
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
    jobs: batch.map((job) => ({ id: job.id, productId: job.productId, targetId: payload(job.rawJson).targetId ?? null, productIds: payload(job.rawJson).productIds ?? [], sku: job.sku, action: job.action, status: job.status, message: job.message, errorSummary: publicJobError(job.errorSummary), createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt })),
  };
}
