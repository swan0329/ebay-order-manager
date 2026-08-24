import "server-only";

import { prisma } from "@/lib/prisma";
import { getEbayConfig } from "@/lib/env";
import { buildVariationListingGroups, type VariationListingGroup } from "@/lib/variation-listing-groups";
import { getVariationListingImagesByIds, withVariationListingMetadata } from "@/lib/variation-listing-products";
import { ensureVariationThumbnail } from "@/lib/services/shopifyVariationMedia";
import { reviseEbayRepresentativePicture, verifyEbayRepresentativePicture } from "@/lib/services/ebayRevise";
import { resolveListingWatermark } from "@/lib/listing-watermark";
import { variationThumbnailHash } from "@/lib/variation-thumbnail-state";
import { Prisma } from "@/generated/prisma";

const JOB_SOURCE = "ebay_variation_image_repair";

export type EbayVariationImageRepairRow = {
  productId: string;
  productIds: string[];
  groupKey: string;
  sku: string;
  productName: string;
  itemId: string;
  quantity: number;
  price: null;
  previousQuantity: null;
  previousPrice: null;
  listingType: "VARIATION";
  optionCount: number;
  imageCount: number;
  actionable: boolean;
  reason: string;
};

async function activeVariationStates(userId: string) {
  const latest = await prisma.ebayReportImport.findFirst({
    where: { userId, completeSnapshot: true },
    orderBy: { createdAt: "desc" },
    select: { listings: { where: { status: "ACTIVE" }, select: { itemId: true } } },
  });
  if (!latest) return [];
  const activeItemIds = latest.listings.map((row) => row.itemId);
  if (!activeItemIds.length) return [];
  return prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { in: activeItemIds } },
    select: { groupKey: true, parentSku: true, title: true, ebayItemId: true, includedProductIds: true, thumbnailUrl: true, thumbnailHash: true },
  });
}

async function groupsForStates(userId: string) {
  const states = await activeVariationStates(userId);
  const ids = [...new Set(states.flatMap((state) => Array.isArray(state.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : []))];
  const images = await getVariationListingImagesByIds(ids);
  const imageById = new Map(images.map((row) => [row.id, row.listingImageUrl]));
  const products = await withVariationListingMetadata(await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, brand: true, category: true, productName: true, optionName: true } }));
  const productById = new Map(products.map((product) => [product.id, product]));
  return states.map((state) => {
    const productIds = Array.isArray(state.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : [];
    const members = productIds.flatMap((id) => {
      const product = productById.get(id); const imageUrl = imageById.get(id);
      return product && imageUrl ? [{ ...product, imageUrl }] : [];
    });
    const rebuilt = buildVariationListingGroups(members).groups.find((group) => group.key === state.groupKey);
    return { state, productIds, group: rebuilt ?? null, imageCount: members.length };
  });
}

function jobHash(raw: Prisma.JsonValue | null) {
  return raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as Record<string, unknown>).thumbnailHash === "string"
    ? String((raw as Record<string, unknown>).thumbnailHash)
    : null;
}

function jobVerified(raw: Prisma.JsonValue | null) {
  return raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).verification === "verified";
}

function verifiedJobJson(raw: Prisma.JsonValue | null) {
  const previous = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, Prisma.JsonValue> : {};
  return { ...previous, verification: "verified", verifiedAt: new Date().toISOString() };
}

function failedVerificationJobJson(raw: Prisma.JsonValue | null) {
  const previous = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, Prisma.JsonValue> : {};
  return { ...previous, verification: "failed", verifiedAt: new Date().toISOString() };
}

function jobVerificationAttempted(raw: Prisma.JsonValue | null) {
  return raw && typeof raw === "object" && !Array.isArray(raw) && ["verified", "failed"].includes(String((raw as Record<string, unknown>).verification));
}

export async function listEbayVariationImageRepairs(userId: string): Promise<EbayVariationImageRepairRow[]> {
  const rows = await groupsForStates(userId);
  const watermark = await resolveListingWatermark(userId);
  const successful = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE, status: "success" },
    orderBy: { finishedAt: "desc" },
    select: { sku: true, rawJson: true },
  });
  const completed = new Set(successful.filter((job) => jobVerified(job.rawJson)).map((job) => `${job.sku}:${jobHash(job.rawJson) ?? ""}`));
  return rows.flatMap(({ state, productIds, group, imageCount }) => {
    if (!state.ebayItemId) return [];
    const targetHash = group ? variationThumbnailHash(group, watermark.signature) : null;
    if (targetHash && completed.has(`ebay-image:${state.ebayItemId}:${targetHash}`)) return [];
    return [{
    productId: `ebay-image:${state.ebayItemId}`,
    productIds,
    groupKey: state.groupKey,
    sku: state.parentSku,
    productName: state.title,
    itemId: state.ebayItemId,
    quantity: 0,
    price: null,
    previousQuantity: null,
    previousPrice: null,
    listingType: "VARIATION" as const,
    optionCount: productIds.length,
    imageCount,
    actionable: Boolean(group && imageCount === productIds.length && productIds.length >= 2),
    reason: group && imageCount === productIds.length ? "현재 워터마크 설정으로 eBay 묶음 대표사진 교체 가능" : `최종 승인 이미지 ${imageCount}/${productIds.length}장 · 누락 이미지를 준비해야 교체 가능`,
    }];
  });
}

export async function repairEbayVariationImage(userId: string, targetId: string) {
  const rows = await groupsForStates(userId);
  const target = rows.find(({ state }) => state.ebayItemId && `ebay-image:${state.ebayItemId}` === targetId);
  if (!target?.state.ebayItemId || !target.group || target.imageCount !== target.productIds.length) throw new Error("eBay 묶음 대표사진 교체 대상을 다시 확인해 주세요.");
  const thumbnailUrl = await ensureVariationThumbnail(userId, target.group as VariationListingGroup);
  const config = getEbayConfig();
  const account = await prisma.ebayAccount.findFirst({ where: { userId, environment: config.environment === "production" ? "PRODUCTION" : "SANDBOX" }, orderBy: { updatedAt: "desc" } });
  if (!account) throw new Error("eBay 계정이 연결되어 있지 않습니다.");
  return reviseEbayRepresentativePicture(account, target.state.ebayItemId, thumbnailUrl);
}

export async function enqueueEbayVariationImageRepairs(userId: string, targetIds: string[]) {
  const rows = await groupsForStates(userId);
  const watermark = await resolveListingWatermark(userId);
  const targets = rows.flatMap((target) => {
    const id = target.state.ebayItemId ? `ebay-image:${target.state.ebayItemId}` : null;
    return id && targetIds.includes(id) && target.group
      ? [{ id, hash: variationThumbnailHash(target.group, watermark.signature) }]
      : [];
  });
  const existing = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE, sku: { in: targets.map((target) => target.id) }, status: { in: ["pending", "running"] } },
    select: { sku: true },
  });
  const queued = new Set(existing.map((job) => job.sku));
  if (targets.some((target) => !queued.has(target.id))) {
    await prisma.productUploadJob.createMany({ data: targets.filter((target) => !queued.has(target.id)).map((target) => ({
      userId, sku: target.id, source: JOB_SOURCE, status: "pending", rawJson: { thumbnailHash: target.hash },
    })) });
  }
  return getEbayVariationImageRepairJobs(userId);
}

export async function processEbayVariationImageRepairJobs(userId: string, limit = 200, reconcileOnly = false) {
  if (!reconcileOnly) await prisma.productUploadJob.updateMany({
    where: { userId, source: JOB_SOURCE, status: "running", startedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "pending", message: "중단된 서버 작업 자동 재개" },
  });
  // 이전 버전은 eBay의 쓰기 응답만으로 success를 저장했다. 재전송하지 않고
  // 현재 eBay 대표사진을 실제로 읽어 제작 썸네일과 같은지 확인해 완료 상태를
  // 승격한다. 확인되지 않은 건은 숫자에서 제거하지 않는다.
  const legacySuccesses = (await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE, OR: [
      { status: "success" },
      { status: "failed", message: "과거 전송 결과 실제 반영 미확인" },
    ] }, orderBy: { finishedAt: "desc" }, take: 200,
  })).filter((job) => !jobVerificationAttempted(job.rawJson)).slice(0, Math.min(20, limit));
  if (legacySuccesses.length) {
    const rows = await groupsForStates(userId);
    const account = await prisma.ebayAccount.findFirst({ where: { userId, environment: getEbayConfig().environment === "production" ? "PRODUCTION" : "SANDBOX" }, orderBy: { updatedAt: "desc" } });
    for (const job of legacySuccesses) {
      const itemId = job.sku.startsWith("ebay-image:") ? job.sku.slice("ebay-image:".length) : "";
      const target = rows.find((row) => row.state.ebayItemId === itemId && row.state.thumbnailUrl && row.state.thumbnailHash === jobHash(job.rawJson));
      try {
        if (!account || !target?.state.thumbnailUrl) throw new Error("과거 대표사진 작업의 대상 썸네일을 확인하지 못했습니다.");
        await verifyEbayRepresentativePicture(account, itemId, target.state.thumbnailUrl);
        await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "success", rawJson: verifiedJobJson(job.rawJson), error: null, errorSummary: null, message: "eBay 재조회로 과거 대표사진 반영 확인 완료" } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "eBay 대표사진 실제 반영 미확인";
        await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", rawJson: failedVerificationJobJson(job.rawJson), error: message, errorSummary: message, message: "과거 전송 결과 실제 반영 미확인" } });
      }
    }
  }
  // 작업 이력이 아예 남지 않은 과거 전송도 현재 활성 Item ID를 기준으로 직접
  // 확인한다. 현재 설정으로 목표 썸네일을 준비한 뒤 eBay 실제 대표사진과 같으면
  // verified 완료 기록을 새로 만들고, 다르면 미확인 기록을 남겨 재검사를 반복하지
  // 않는다. 이 경로는 eBay에 사진을 다시 전송하지 않는다.
  const reconciliationCapacity = Math.max(0, Math.min(20, limit) - legacySuccesses.length);
  if (reconciliationCapacity) {
    const rows = await groupsForStates(userId);
    const watermark = await resolveListingWatermark(userId);
    const account = await prisma.ebayAccount.findFirst({ where: { userId, environment: getEbayConfig().environment === "production" ? "PRODUCTION" : "SANDBOX" }, orderBy: { updatedAt: "desc" } });
    const previousJobs = await prisma.productUploadJob.findMany({ where: { userId, source: JOB_SOURCE }, select: { sku: true, rawJson: true } });
    const attempted = new Set(previousJobs.filter((job) => jobVerificationAttempted(job.rawJson)).map((job) => `${job.sku}:${jobHash(job.rawJson) ?? ""}`));
    const candidates = rows.flatMap((row) => {
      if (!row.state.ebayItemId || !row.group || row.imageCount !== row.productIds.length) return [];
      const id = `ebay-image:${row.state.ebayItemId}`;
      const hash = variationThumbnailHash(row.group, watermark.signature);
      return attempted.has(`${id}:${hash}`) ? [] : [{ ...row, id, hash }];
    }).slice(0, reconciliationCapacity);
    for (const candidate of candidates) {
      let expectedUrl: string | null = null;
      try {
        if (!account) throw new Error("eBay 계정이 연결되어 있지 않습니다.");
        expectedUrl = await ensureVariationThumbnail(userId, candidate.group as VariationListingGroup);
        await verifyEbayRepresentativePicture(account, candidate.state.ebayItemId!, expectedUrl);
        await prisma.productUploadJob.create({ data: { userId, source: JOB_SOURCE, sku: candidate.id, status: "success", message: "eBay 재조회로 대표사진 반영 확인 완료", rawJson: verifiedJobJson({ thumbnailHash: candidate.hash }), startedAt: new Date(), finishedAt: new Date() } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "eBay 대표사진 실제 반영 미확인";
        await prisma.productUploadJob.create({ data: { userId, source: JOB_SOURCE, sku: candidate.id, status: "failed", message: "현재 eBay 대표사진 실제 반영 미확인", error: message, errorSummary: message, rawJson: failedVerificationJobJson({ thumbnailHash: candidate.hash, expectedUrl }), startedAt: new Date(), finishedAt: new Date() } });
      }
    }
  }
  if (reconcileOnly) return getEbayVariationImageRepairJobs(userId);
  const jobs = await prisma.productUploadJob.findMany({
    where: { userId, source: JOB_SOURCE, status: "pending" }, orderBy: { createdAt: "asc" }, take: limit,
  });
  for (const job of jobs) {
    const claimed = await prisma.productUploadJob.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "running", startedAt: new Date(), error: null, errorSummary: null } });
    if (!claimed.count) continue;
    try {
      await repairEbayVariationImage(userId, job.sku);
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "success", rawJson: verifiedJobJson(job.rawJson), message: "eBay 재조회로 묶음 대표사진 반영 확인 완료", finishedAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "eBay 대표사진 교체 실패";
      await prisma.productUploadJob.update({ where: { id: job.id }, data: { status: "failed", error: message, errorSummary: message, finishedAt: new Date() } });
    }
  }
  return getEbayVariationImageRepairJobs(userId);
}

export async function getEbayVariationImageRepairJobs(userId: string) {
  const jobs = await prisma.productUploadJob.findMany({ where: { userId, source: JOB_SOURCE }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, sku: true, status: true, message: true, errorSummary: true, rawJson: true, createdAt: true, startedAt: true, finishedAt: true } });
  const active = jobs.filter((job) => ["pending", "running"].includes(job.status));
  const latestStart = jobs[0]?.createdAt;
  const batch = latestStart ? jobs.filter((job) => Math.abs(job.createdAt.getTime() - latestStart.getTime()) < 10_000) : [];
  return { active: active.length, pending: active.filter((job) => job.status === "pending" || job.status === "success").length, running: active.filter((job) => job.status === "running").length, succeeded: batch.filter((job) => job.status === "success" && jobVerified(job.rawJson)).length, failed: batch.filter((job) => job.status === "failed").length, total: batch.length, jobs: jobs.slice(0, 50).map((job) => ({ id: job.id, sku: job.sku, status: job.status, message: job.message, errorSummary: job.errorSummary, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt })) };
}
