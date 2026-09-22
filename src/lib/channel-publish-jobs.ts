import { refreshProcurementProduct } from "@/lib/procurement-refresh";
import { repairEbayImages } from "@/lib/ebay-image-repair";
import { ShopifyMediaPendingError } from "@/lib/shopify-gallery";
import { selectChangedProducts } from "@/lib/change-product-selection";
import { getChannelImageChanges, recordChannelImageSync } from "@/lib/channel-image-changes";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { uploadDraft } from "@/lib/services/ebayListingUploadService";
import {
  archiveShopifyProduct,
  syncShopifyImages,
  syncShopifyPriceAndInventory,
  uploadProductToShopify,
  uploadVariationGroupToShopify,
  publishExistingShopifyProduct,
} from "@/lib/services/shopifyService";
import {
  getVariationCandidateProductIds,
  getEbayVariationMembershipByProductId,
  getVariationListingGroups,
} from "@/lib/variation-listing-products";
import { createDraftsFromInventory } from "@/lib/services/listingDraftService";
import { publishEbayVariationGroup } from "@/lib/ebay-variation-publish";
import { listingQuantity } from "@/lib/listing-quantity";
import { requestEbayActiveReport } from "@/lib/ebay-active-report-task";
import { safeLog } from "@/lib/safe-log";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { channelPublishLeaseMs, PublishContinuationError } from "@/lib/channel-publish-runtime";
import { publishJobLabel, WAITING_STATUS } from "@/lib/channel-publish-constants";

export type PublishChannel = "EBAY" | "SHOPIFY";
export type PublishMode = "REGISTER" | "UPSERT" | "PRICE_INVENTORY" | "IMAGES" | "ARCHIVE";
const terminalStatuses = ["COMPLETED", "COMPLETED_WITH_ERROR", "FAILED", "CANCELLED"];
/** 줄이 끝없이 길어지지 않게 한 채널·작업당 대기 수를 제한한다. */
const maxWaitingJobsPerKey = 5;

type PublishJobItem = { targetType: string; targetId: string; sku: string };

class AlreadyRegistered extends Error {}
function registeredId(product: { ebayItemId?: string | null; shopifyProductId?: string | null; shopifyStatus?: string | null }, channel: string) {
  if (channel === "SHOPIFY" && product.shopifyStatus?.toLowerCase() === "publication_pending") return null;
  return (channel === "EBAY" ? product.ebayItemId : product.shopifyProductId)?.trim() || null;
}

async function createExclusivePublishJob(input: {
  userId: string;
  channel: PublishChannel;
  mode: PublishMode;
  items: PublishJobItem[];
}) {
  const activeKey = `${input.userId}:${input.channel}:${input.mode}`;
  try {
    const job = await prisma.channelPublishJob.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        mode: input.mode,
        activeKey,
        totalCount: input.items.length,
        items: { create: input.items },
      },
      include: { items: true },
    });
    return { ...job, reusedActiveJob: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const active = await prisma.channelPublishJob.findUnique({
      where: { activeKey },
      include: { items: true },
    });
    if (!active || terminalStatuses.includes(active.status)) throw error;
    const sameItems = (items: Array<{ targetType: string; targetId: string }>) => {
      const requested = new Set(input.items.map(item => `${item.targetType}:${item.targetId}`));
      return items.length === requested.size &&
        items.every(item => requested.has(`${item.targetType}:${item.targetId}`));
    };
    if (sameItems(active.items)) return { ...active, reusedActiveJob: true };

    // 같은 대상이 이미 줄을 서 있으면 또 세우지 않는다.
    const waiting = await prisma.channelPublishJob.findMany({
      where: { userId: input.userId, channel: input.channel, mode: input.mode, status: WAITING_STATUS },
      orderBy: { createdAt: "asc" },
      include: { items: true },
    });
    const duplicate = waiting.find(job => sameItems(job.items));
    if (duplicate) return { ...duplicate, reusedActiveJob: true };
    if (waiting.length >= maxWaitingJobsPerKey) {
      throw new Error(
        `${publishJobLabel(input.channel, input.mode)} 작업이 이미 ${waiting.length}건 대기 중입니다.` +
        " 대기 중인 작업이 끝난 뒤 다시 실행하거나, 진행 중 작업을 중단해 주세요.",
      );
    }
    // 거절하지 않고 줄을 세운다. activeKey는 차례가 됐을 때 잡는다.
    const queued = await prisma.channelPublishJob.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        mode: input.mode,
        activeKey: null,
        status: WAITING_STATUS,
        totalCount: input.items.length,
        items: { create: input.items },
      },
      include: { items: true },
    });
    return { ...queued, reusedActiveJob: false, waitingBehind: waiting.length + 1 };
  }
}

function safeError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    ("code" in error && error.code === "P2024" ||
      "message" in error && String(error.message).includes("connection pool"))
  ) {
    return "서버 데이터베이스 연결이 일시적으로 혼잡했습니다. 자동 재시도 후에도 계속되면 잠시 뒤 다시 실행해 주세요.";
  }
  if (error instanceof EbayApiError) {
    const body = error.body;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      const errors = Array.isArray(record.errors) ? record.errors : [];
      const first = errors.find(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      );
      const message =
        String(first?.longMessage ?? "").trim() ||
        String(first?.message ?? "").trim() ||
        String(record.message ?? "").trim() ||
        String(record.error_description ?? "").trim();
      const errorId = String(first?.errorId ?? "").trim();
      if (message) {
        const sku = error.diagnostics?.inventorySku;
        return `${sku ? `카드 ${String(sku)} 전송 실패 · ` : ""}eBay 오류${errorId ? ` ${errorId}` : ""}: ${message}`.slice(0, 1000);
      }
    }
    return `eBay 오류: HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message.slice(0, 1000) : "등록 처리 중 오류가 발생했습니다.";
}

function isRetryableDatabaseError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (("code" in error && error.code === "P2024") ||
        ("message" in error && String(error.message).includes("connection pool"))),
  );
}

export async function createChannelPublishJob(input: {
  userId: string;
  channel: PublishChannel;
  mode?: PublishMode;
  targetIds: string[];
}) {
  const targetIds = [...new Set(input.targetIds)].filter(Boolean);
  if (!targetIds.length || targetIds.length > 500) {
    throw new Error("등록 대상은 1~500개까지 선택할 수 있습니다.");
  }
  if (input.mode === "IMAGES") {
    const products = await prisma.product.findMany({ where: { id: { in: targetIds } }, select: { id: true, sku: true, ebayItemId: true, shopifyProductId: true } });
    if (products.length !== targetIds.length) throw new Error("이미지 교체 상품을 찾을 수 없습니다.");
    const membership = input.channel === "EBAY" ? await getEbayVariationMembershipByProductId(input.userId) : new Map<string, string>();
    const parents = new Map<string, (typeof products)[number]>();
    for (const product of products) {
      const parent = input.channel === "EBAY" ? membership.get(product.id) ?? product.ebayItemId : product.shopifyProductId;
      if (!parent) throw new Error(`${product.sku}: 등록된 채널 상품이 없습니다.`);
      if (!parents.has(parent)) parents.set(parent, product);
    }
    return createExclusivePublishJob({ userId: input.userId, channel: input.channel, mode: "IMAGES", items: [...parents.values()].map(p=>({targetType:"PRODUCT",targetId:p.id,sku:p.sku})) });
  }
  if (input.channel === "SHOPIFY" && (input.mode ?? "UPSERT") === "UPSERT") {
    const variationCandidateIds = await getVariationCandidateProductIds();
    const unlinkedCandidates = await prisma.product.findMany({
      where: { id: { in: targetIds }, shopifyProductId: null },
      select: { id: true },
    });
    const blocked = unlinkedCandidates.filter((product) =>
      variationCandidateIds.has(product.id),
    );
    if (blocked.length) {
      throw new Error(
        `선택한 상품 중 ${blocked.length}개는 옵션상품 후보라 Shopify 개별 등록을 중단했습니다. 현재 Shopify 옵션 등록은 별도 지원이 필요합니다.`,
      );
    }
  }

  const targets = input.channel === "EBAY"
    ? await prisma.listingDraft.findMany({
        where: { userId: input.userId, id: { in: targetIds } },
        select: { id: true, sku: true },
      })
    : await prisma.product.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, sku: true },
      });
  if (targets.length !== targetIds.length) {
    throw new Error("등록 대상 중 찾을 수 없거나 접근할 수 없는 항목이 있습니다.");
  }

  return createExclusivePublishJob({
    userId: input.userId,
    channel: input.channel,
    mode: input.mode ?? "UPSERT",
    items: targets.map((target) => ({
      targetType: input.channel === "EBAY" ? "LISTING_DRAFT" : "PRODUCT",
      targetId: target.id,
      sku: target.sku,
    })),
  });
}

export async function createAutomaticProductPublishJob(input: {
  userId: string;
  channel: PublishChannel;
  productIds: string[];
  expectedOptionProductIds?: string[];
}) {
  let productIds = [...new Set(input.productIds)].filter(Boolean);
  if (!productIds.length || productIds.length > 500) {
    throw new Error("상품 등록 대상은 1~500개까지 선택할 수 있습니다.");
  }
  const selectedProducts = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, ebayItemId: true, shopifyProductId: true, shopifyStatus: true },
  });
  if (selectedProducts.length !== productIds.length) throw new Error("등록 상품을 찾을 수 없습니다.");
  const registered = selectedProducts.filter((product) => registeredId(product, input.channel));
  const registeredIds = new Set(registered.map((product) => product.id));
  productIds = productIds.filter((id) => !registeredIds.has(id));
  const selected = new Set(productIds);
  const groups = (productIds.length ? await getVariationListingGroups() : []).filter((group) =>
    group.products.some((product) => selected.has(product.id)),
  );
  const groupedIds = new Set(groups.flatMap((group) => group.products.map((product) => product.id)));
  if (input.expectedOptionProductIds && registered.length === 0) {
    const actual = new Set([...productIds, ...groupedIds]);
    const expected = new Set(input.expectedOptionProductIds);
    if (actual.size !== expected.size || [...actual].some((id) => !expected.has(id))) {
      throw new Error("미리보기 이후 옵션 구성이 변경됐습니다. 대상을 다시 확인해 주세요.");
    }
  }
  const singleIds = productIds.filter((id) => !groupedIds.has(id));
  const items: PublishJobItem[] = groups.map((group) => ({
    targetType: input.channel === "EBAY" ? "EBAY_VARIATION_GROUP" : "SHOPIFY_VARIATION_GROUP",
    targetId: input.expectedOptionProductIds ? JSON.stringify({ productId: group.products[0].id, memberIds: group.products.map((product) => product.id) }) : group.products[0].id,
    sku: group.products[0].sku,
  }));
  items.push(...registered.map((product) => ({ targetType: "REGISTERED_PRODUCT", targetId: product.id, sku: product.sku })));

  if (input.channel === "EBAY" && singleIds.length) {
    // Product.status is an overall inventory workflow state, not an eBay listing state.
    // Automatic publishing also repairs older drafts that predate automatic defaults.
    await createDraftsFromInventory({
      userId: input.userId,
      productIds: singleIds,
      allowAnyProductStatus: true,
      automaticPublish: true,
    });
    const drafts = await prisma.listingDraft.findMany({
      where: { userId: input.userId, sourceInventoryId: { in: singleIds } },
      orderBy: { updatedAt: "desc" },
    });
    const latestByProduct = new Map<string, (typeof drafts)[number]>();
    for (const draft of drafts) {
      if (draft.sourceInventoryId && !latestByProduct.has(draft.sourceInventoryId)) {
        latestByProduct.set(draft.sourceInventoryId, draft);
      }
    }
    const unresolvedIds = singleIds.filter((productId) => !latestByProduct.has(productId));
    if (unresolvedIds.length) {
      const unresolvedProducts = await prisma.product.findMany({
        where: { id: { in: unresolvedIds } },
        select: { id: true, sku: true, status: true },
        orderBy: { sku: "asc" },
      });
      const foundIds = new Set(unresolvedProducts.map((product) => product.id));
      const details = unresolvedProducts
        .slice(0, 10)
        .map((product) => `${product.sku}(${product.status})`);
      const deletedCount = unresolvedIds.filter((id) => !foundIds.has(id)).length;
      if (deletedCount) details.push(`조회되지 않은 상품 ${deletedCount}개`);
      throw new Error(
        `eBay 단품 등록 초안 ${unresolvedIds.length}개를 만들지 못했습니다. 실패 상품: ${details.join(", ")}`,
      );
    }
    for (const productId of singleIds) {
      const draft = latestByProduct.get(productId);
      if (!draft) continue;
      items.push({ targetType: "LISTING_DRAFT", targetId: draft.id, sku: draft.sku });
    }
  } else if (input.channel === "SHOPIFY" && singleIds.length) {
    const products = await prisma.product.findMany({
      where: { id: { in: singleIds } },
      select: { id: true, sku: true },
    });
    if (products.length !== singleIds.length) throw new Error("Shopify 등록 상품을 찾을 수 없습니다.");
    items.push(...products.map((product) => ({ targetType: "PRODUCT", targetId: product.id, sku: product.sku })));
  }
  if (!items.length) throw new Error("새로 등록할 상품이 없습니다.");
  return createExclusivePublishJob({
    userId: input.userId,
    channel: input.channel,
    mode: "REGISTER",
    items,
  });
}

export async function createShopifyAutomaticOperationJob(input: {
  userId: string;
  operation: "revise" | "end";
  limit?: number;
  productIds?: string[];
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 500, 500));
  const rows = selectChangedProducts(await getShopifyAutomaticOperationProductIds(input.operation), input.productIds, row => row.id).slice(0, limit);
  if (!rows.length) {
    throw new Error(
      input.operation === "end"
        ? "Shopify에서 판매중단할 상품이 없습니다."
        : "Shopify에 반영할 연결 상품이 없습니다.",
    );
  }
  return createChannelPublishJob({
    userId: input.userId,
    channel: "SHOPIFY",
    mode: input.operation === "end" ? "ARCHIVE" : "PRICE_INVENTORY",
    targetIds: rows.map((row) => row.id),
  });
}

export async function getShopifyAutomaticOperationProductIds(
  operation: "revise" | "end",
) {
  if (operation === "end") {
    return prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "products"
        WHERE COALESCE("shopify_product_id", '') <> ''
          AND UPPER(COALESCE("shopify_status", 'ACTIVE')) NOT IN ('ARCHIVED', 'DRAFT', 'OUT_OF_STOCK')
          AND "stock_quantity" <= 0
          AND "pocamarket_synced_at" IS NOT NULL
          AND "pocamarket_available_count" = 0
          AND (COALESCE("sale_price", 0) > 0 OR COALESCE("final_listing_price_usd", 0) > 0)
        ORDER BY "sku" ASC
      `;
  }

  const [products, settings] = await Promise.all([
    prisma.product.findMany({
      where: {
        shopifyProductId: { not: "" },
        shopifyVariantId: { not: "" },
        shopifyInventoryItemId: { not: "" },
        shopifyStatus: { notIn: ["ARCHIVED", "archived", "DRAFT", "draft"] },
      },
      orderBy: { sku: "asc" },
    }),
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
  ]);

  // 시각 비교는 이미지 업로드가 가격 변경을 가리는 문제가 있다. 실제로 채널에
  // 보낼 계산 USD·수량과 마지막 성공 반영값을 직접 비교해야만 빠짐과 재등장이 없다.
  return products.filter((product) => {
    const expectedPrice = resolveListingPriceUsd(product, settings ?? undefined)?.priceUsd;
    const lastPrice = product.shopifyLastSyncedPrice;
    const priceChanged = Boolean(
      expectedPrice &&
      (lastPrice === null || Math.abs(Number(lastPrice) - Number(expectedPrice)) >= 0.01),
    );
    const expectedQuantity = expectedPrice ? listingQuantity(product) : 0;
    const quantityChanged =
      product.shopifyLastSyncedQuantity === null ||
      product.shopifyLastSyncedQuantity !== expectedQuantity;
    const holdChanged = !expectedPrice
      ? product.shopifyStatus !== "PRICE_HOLD"
      : product.shopifyStatus === "PRICE_HOLD";
    return priceChanged || quantityChanged || holdChanged;
  }).map(({ id }) => ({ id }));
}

export async function getChannelPublishJob(userId: string, jobId: string, allFailures = false) {
  const job = await prisma.channelPublishJob.findFirst({
    where: { id: jobId, userId },
    include: {
      items: {
        where: { status: { in: ["FAILED", "PROCESSING", "SKIPPED"] } },
        orderBy: { createdAt: "asc" },
        take: allFailures ? 500 : 50,
        select: { id: true, sku: true, status: true, error: true, targetId: true },
      },
    },
  });
  if (!job) return null;
  return {
    ...job,
    items: job.items.map((item) => ({
      ...item,
      error: item.error ? safeError(new Error(item.error)) : null,
    })),
  };
}

export async function getLatestImagePublishJobs(userId: string) {
  const jobs = [];
  for (const channel of ["EBAY", "SHOPIFY"] as const) {
    const job = await prisma.channelPublishJob.findFirst({
      where: { userId, channel, mode: "IMAGES" }, orderBy: { createdAt: "desc" },
      include: { items: { where: { status: { in: ["FAILED", "PROCESSING", "SKIPPED"] } }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, sku: true, status: true, error: true } } },
    });
    jobs.push(job ? { ...job, items: job.items.map(item => ({ ...item, error: item.error ? safeError(new Error(item.error)) : null })) } : null);
  }
  return jobs;
}

export async function getActiveChannelPublishJobs(userId: string) {
  return prisma.channelPublishJob.findMany({
    where: { userId, status: { notIn: terminalStatuses } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

export async function getRecentChannelPublishJobs(userId: string) {
  return prisma.channelPublishJob.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, channel: true, mode: true, status: true, totalCount: true, successCount: true, failureCount: true,
      items: { where: { status: "FAILED" }, select: { sku: true, error: true, targetId: true, targetType: true }, take: 50 } },
  });
}

export async function cancelActiveChannelPublishJobs(userId: string) {
  const jobs = await prisma.channelPublishJob.findMany({
    where: { userId, status: { notIn: terminalStatuses } },
    select: { id: true },
  });
  if (!jobs.length) return { cancelledJobs: 0, cancelledItems: 0 };

  const jobIds = jobs.map((job) => job.id);
  const now = new Date();
  const [items] = await prisma.$transaction([
    prisma.channelPublishItem.updateMany({
      where: { jobId: { in: jobIds }, status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "사용자가 등록 작업을 중단했습니다.",
        completedAt: now,
      },
    }),
    prisma.channelPublishJob.updateMany({
      where: { id: { in: jobIds }, status: { notIn: terminalStatuses } },
      data: { status: "CANCELLED", activeKey: null, completedAt: now },
    }),
  ]);
  return { cancelledJobs: jobs.length, cancelledItems: items.count };
}

async function claimItems(jobId: string, limit: number) {
  const claimed = [];
  for (let count = 0; count < limit; count += 1) {
    const candidate = await prisma.channelPublishItem.findFirst({
      where: { jobId, status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) break;
    const updated = await prisma.channelPublishItem.updateMany({
      where: { id: candidate.id, status: "QUEUED" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), error: null },
    });
    if (updated.count) claimed.push({ ...candidate, attempts: candidate.attempts + 1 });
  }
  return claimed;
}

async function processItem(
  job: { id: string; userId: string; channel: string; mode: string },
  item: { id: string; targetType: string; targetId: string; attempts: number },
) {
  try {
    let externalId: string | null = null;
    let imageChange: Awaited<ReturnType<typeof getChannelImageChanges>>[number] | undefined;
    if (job.mode === "IMAGES") {
      const product = await prisma.product.findUnique({ where: { id: item.targetId } });
      const parent = product && (job.channel === "EBAY" ? (await getEbayVariationMembershipByProductId(job.userId)).get(product.id) ?? registeredId(product, job.channel) : registeredId(product, job.channel));
      if (!parent) {
        // 반영할 수 없는 상태를 실패로 쌓으면 같은 건이 매번 실패 목록에 남는다.
        // 무엇을 먼저 해야 하는지 알려 주고 건너뛴다.
        const pendingPublication =
          job.channel === "SHOPIFY" &&
          Boolean(product?.shopifyProductId) &&
          product?.shopifyStatus?.toLowerCase() === "publication_pending";
        throw new AlreadyRegistered(
          pendingPublication
            ? "Shopify 게시 대기 상태 · 게시할 때 이미지가 함께 반영됩니다"
            : "채널 연결이 없어 이미지 반영 대상이 아닙니다 · 신규등록이 먼저입니다",
        );
      }
      imageChange = (await getChannelImageChanges(job.userId, job.channel as PublishChannel, parent))[0];
      if (!imageChange) throw new AlreadyRegistered("이미지 변경 없음 · 이미 반영 완료");
    }
    const snapshot = item.targetType?.endsWith("VARIATION_GROUP") && item.targetId.startsWith("{")
      ? JSON.parse(item.targetId) as { productId: string; memberIds: string[] } : null;
    const targetProductId = snapshot?.productId ?? item.targetId;
    const checkSnapshot = (products: Array<{ id: string }>) => {
      if (snapshot && (products.length !== snapshot.memberIds.length || products.some((product) => !snapshot.memberIds.includes(product.id)))) {
        throw new Error("미리보기 이후 옵션 구성이 변경됐습니다. 대상을 다시 확인해 주세요.");
      }
    };
    if (item.targetType === "REGISTERED_PRODUCT") throw new AlreadyRegistered("이미 등록 완료");
    if (job.mode === "REGISTER" && !item.targetType.endsWith("VARIATION_GROUP")) {
      const draft = item.targetType === "LISTING_DRAFT"
        ? await prisma.listingDraft.findFirst({ where: { id: item.targetId, userId: job.userId } }) : null;
      const productId = draft?.sourceInventoryId ?? (item.targetType === "LISTING_DRAFT" ? null : item.targetId);
      const product = productId ? await prisma.product.findUnique({ where: { id: productId } }) : null;
      if (product && registeredId(product, job.channel)) throw new AlreadyRegistered("이미 등록 완료");
    }
    if (item.targetType === "EBAY_VARIATION_GROUP") {
      const groups = await getVariationListingGroups();
      const group = groups.find((candidate) =>
        candidate.products.some((product) => product.id === targetProductId),
      );
      if (!group) throw new Error("eBay 옵션 묶음이 변경되어 등록할 수 없습니다.");
      checkSnapshot(group.products);
      if (job.mode === "REGISTER" && group.products.every((product) => registeredId(product, job.channel))) throw new AlreadyRegistered("이미 등록 완료");
      const result = await publishEbayVariationGroup(job.userId, group, {
        prepareDeadline: Date.now() + 150_000,
        onProgress: async (stage) => {
          safeLog("info", "channel.publish.progress", { jobId: job.id, itemId: item.id, stage });
          await prisma.channelPublishItem.update({ where: { id: item.id }, data: { error: `진행: ${stage}` } });
        },
      });
      externalId = result.listingId;
    } else if (item.targetType === "SHOPIFY_VARIATION_GROUP") {
      const groups = await getVariationListingGroups();
      const group = groups.find((candidate) =>
        candidate.products.some((product) => product.id === targetProductId),
      );
      if (!group) throw new Error("Shopify 옵션 묶음이 변경되어 등록할 수 없습니다.");
      checkSnapshot(group.products);
      if (job.mode === "REGISTER" && group.products.every((product) => registeredId(product, job.channel))) throw new AlreadyRegistered("이미 등록 완료");
      const result = await uploadVariationGroupToShopify(group, job.userId);
      externalId = result.productId;
    } else if (job.channel === "EBAY" && job.mode === "IMAGES") {
      const result = await repairEbayImages(job.userId, item.targetId);
      if ("skipped" in result && result.skipped) throw new AlreadyRegistered(result.reason);
      externalId = result.listingId;
    } else if (job.channel === "EBAY") {
      const draft = await prisma.listingDraft.findFirst({
        where: { id: item.targetId, userId: job.userId },
      });
      if (!draft) throw new Error("eBay 등록 초안을 찾을 수 없습니다.");
      const result = await uploadDraft(job.userId, draft);
      if (!("result" in result) || !result.result) throw new Error(result.error);
      externalId = result.result.listingId ?? result.result.offerId;
    } else {
      let product = await prisma.product.findUnique({ where: { id: item.targetId } });
      if (!product) throw new Error("Shopify 등록 상품을 찾을 수 없습니다.");
      if (["PRICE_INVENTORY", "REGISTER", "UPSERT"].includes(job.mode)) product = await refreshProcurementProduct(product, job.userId);
      const syncedPrice = job.mode === "PRICE_INVENTORY" || job.mode === "UPSERT" || job.mode === "REGISTER"
        ? resolveListingPriceUsd(
            product,
            await prisma.pricingSettings.findUnique({ where: { id: "default" } }) ?? undefined,
          )?.priceUsd ?? null
        : null;
      const linked = Boolean(
        product.shopifyProductId &&
        product.shopifyVariantId &&
        product.shopifyInventoryItemId,
      );
      let result;
      let localShopifyStatus: string | null | undefined;
      if (job.mode === "ARCHIVE") {
        const sellableSibling = product.shopifyProductId
          ? await prisma.product.findFirst({
              where: {
                id: { not: product.id },
                shopifyProductId: product.shopifyProductId,
                OR: [
                  { stockQuantity: { gt: 0 } },
                  { pocamarketAvailableCount: { gt: 0 } },
                ],
              },
              select: { id: true },
            })
          : null;
        // One sold-out variant must not archive the shared Shopify product.
        // Setting this variant's inventory to 0 keeps the other options live.
        result = sellableSibling
          ? await syncShopifyPriceAndInventory(product)
          : await archiveShopifyProduct(product);
        localShopifyStatus = sellableSibling ? "OUT_OF_STOCK" : result.status;
      } else if (job.mode === "IMAGES") {
        result = await syncShopifyImages(product, job.userId, true);
      } else if (linked) {
        if (job.mode !== "PRICE_INVENTORY" && product.shopifyStatus?.toLowerCase() === "publication_pending") {
          await publishExistingShopifyProduct(product.shopifyProductId!, job.userId);
        }
        result = await syncShopifyPriceAndInventory(product);
        localShopifyStatus = !syncedPrice ? "PRICE_HOLD" :
          job.mode === "PRICE_INVENTORY" && product.shopifyStatus?.toLowerCase() === "publication_pending"
            ? product.shopifyStatus :
          product.stockQuantity > 0 || (product.pocamarketAvailableCount ?? 0) > 0
            ? "ACTIVE"
            : result.status;
      } else {
        result = await uploadProductToShopify(product, {
          featuredMembers: product.featuredMembers,
        }, job.userId);
      }
      externalId = result.productId;
      await prisma.product.update({
        where: { id: product.id },
        data: {
          shopifyProductId: result.productId,
          shopifyVariantId: result.variantId,
          shopifyInventoryItemId: result.inventoryItemId,
          ...(job.mode === "IMAGES" ? {} : { shopifyStatus: localShopifyStatus ?? result.status }),
          shopifyLastUploadedAt: new Date(),
          ...(job.mode === "PRICE_INVENTORY" || job.mode === "UPSERT" || job.mode === "REGISTER" ? {
            // 포카마켓 가격 상품도 실제로 Shopify에 보낸 계산 USD를 기록해야
            // 다음 대상 집계에서 같은 상품을 다시 변경 대상으로 잡지 않는다.
            shopifyLastSyncedPrice: syncedPrice,
            shopifyLastSyncedQuantity: syncedPrice ? listingQuantity(product) : 0,
          } : {}),
          shopifyUploadError: null,
        },
      });
    }

    if (imageChange) {
      const current = (await getChannelImageChanges(job.userId, job.channel as PublishChannel, imageChange.parent))[0];
      if (current?.fingerprint !== imageChange.fingerprint) throw new Error("이미지 반영 중 원본 또는 설정이 변경됐습니다. 변동처리를 다시 실행해 주세요.");
      await recordChannelImageSync(job.userId, job.channel as PublishChannel, imageChange);
    }
    await prisma.$transaction([
      prisma.channelPublishItem.update({
        where: { id: item.id },
        data: { status: "COMPLETED", externalId, completedAt: new Date(), error: null },
      }),
      prisma.channelPublishJob.update({
        where: { id: job.id },
        data: {
          processedCount: { increment: 1 },
          successCount: { increment: 1 },
        },
      }),
    ]);
  } catch (error) {
    if (error instanceof AlreadyRegistered) {
      await prisma.$transaction([
        prisma.channelPublishItem.update({ where: { id: item.id }, data: { status: "SKIPPED", error: error.message, completedAt: new Date() } }),
        prisma.channelPublishJob.update({ where: { id: job.id }, data: { processedCount: { increment: 1 } } }),
      ]);
      return;
    }
    if (error instanceof PublishContinuationError) {
      await prisma.channelPublishItem.update({
        where: { id: item.id },
        data: { status: "QUEUED", startedAt: null, attempts: { decrement: 1 }, error: error.message },
      });
      return;
    }
    if ((job.mode === "IMAGES" && error instanceof Error && /이미지 준비 중 판매 정보가 변경/.test(error.message) && item.attempts < 3) || (isRetryableDatabaseError(error) && item.attempts < 2) || (error instanceof ShopifyMediaPendingError && item.attempts < 4)) {
      await prisma.channelPublishItem.update({
        where: { id: item.id },
        data: {
          status: "QUEUED",
          error: safeError(error),
          startedAt: null,
          completedAt: null,
        },
      });
      return;
    }
    await prisma.$transaction([
      prisma.channelPublishItem.update({
        where: { id: item.id },
        data: { status: "FAILED", error: safeError(error), completedAt: new Date() },
      }),
      prisma.channelPublishJob.update({
        where: { id: job.id },
        data: {
          processedCount: { increment: 1 },
          failureCount: { increment: 1 },
        },
      }),
    ]);
  }
}

/** 실행 권리(activeKey)를 잡아 본다. 이미 다른 작업이 쥐고 있으면 false. */
async function claimJobTurn(job: { id: string; userId: string; channel: string; mode: string }) {
  const activeKey = `${job.userId}:${job.channel}:${job.mode}`;
  try {
    await prisma.channelPublishJob.update({
      where: { id: job.id },
      data: { activeKey, status: "QUEUED" },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/** 같은 채널·작업에서 가장 먼저 줄을 선 작업을 깨운다. */
async function wakeNextWaitingJob(userId: string, channel: string, mode: string) {
  const next = await prisma.channelPublishJob.findFirst({
    where: { userId, channel, mode, status: WAITING_STATUS },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, channel: true, mode: true },
  });
  if (!next) return null;
  if (!(await claimJobTurn(next))) return null;
  return next.id;
}

export async function processChannelPublishJob(jobId: string, limit = 1) {
  const job = await prisma.channelPublishJob.findUnique({ where: { id: jobId } });
  if (!job || terminalStatuses.includes(job.status)) {
    return { job, shouldContinue: false, busy: false };
  }

  // 줄을 선 작업은 앞 작업이 activeKey를 놓아야 실행할 수 있다. 고유 키라 둘이
  // 동시에 잡을 수 없고, 못 잡으면 아직 차례가 아니므로 아무것도 하지 않는다.
  if (job.status === WAITING_STATUS || job.activeKey === null) {
    const claimed = await claimJobTurn(job);
    if (!claimed) return { job, shouldContinue: false, busy: true };
  }

  const staleMs = channelPublishLeaseMs;
  const staleBefore = new Date(Date.now() - staleMs);
  const workerToken = randomUUID();
  const acquired = await prisma.channelPublishJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { workerLeaseExpiresAt: null },
        { workerLeaseExpiresAt: { lt: new Date() } },
      ],
    },
    data: {
      workerToken,
      workerLeaseExpiresAt: new Date(Date.now() + staleMs),
    },
  });
  if (!acquired.count) {
    return { job, shouldContinue: false, busy: true };
  }

  try {
    await prisma.channelPublishItem.updateMany({
      where: { jobId, status: "PROCESSING", startedAt: { lt: staleBefore }, attempts: { gte: 2 } },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: "등록 서버 실행이 두 차례 중단되어 작업을 멈췄습니다. 이베이 응답 오류와는 다를 수 있으며 마지막 진행 단계의 확인이 필요합니다.",
      },
    });
    await prisma.channelPublishItem.updateMany({
      where: { jobId, status: "PROCESSING", startedAt: { lt: staleBefore }, attempts: { lt: 2 } },
      data: { status: "QUEUED", startedAt: null },
    });
    await prisma.channelPublishJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const maxItems = job.mode === "IMAGES" || job.channel === "SHOPIFY" && job.mode === "PRICE_INVENTORY" ? 3 : 1;
    const items = await claimItems(jobId, Math.max(1, Math.min(limit, maxItems)));
    await Promise.all(items.map((item) => processItem(job, item)));

    const groups = await prisma.channelPublishItem.groupBy({
      by: ["status"],
      where: { jobId },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
    const successCount = counts.COMPLETED ?? 0;
    const failureCount = counts.FAILED ?? 0;
    const processedCount = successCount + failureCount + (counts.SKIPPED ?? 0);
    const queued = (counts.QUEUED ?? 0) > 0;
    const stillProcessing = (counts.PROCESSING ?? 0) > 0;
    const finished = !queued && !stillProcessing;
    const status = finished
      ? failureCount > 0 ? "COMPLETED_WITH_ERROR" : "COMPLETED"
      : "RUNNING";
    const currentJob = await prisma.channelPublishJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    const cancelled = currentJob?.status === "CANCELLED";
    const updated = await prisma.channelPublishJob.update({
      where: { id: jobId },
      data: {
        status: cancelled ? "CANCELLED" : status,
        activeKey: finished ? null : undefined,
        processedCount,
        successCount,
        failureCount,
        completedAt: cancelled || finished ? new Date() : null,
      },
    });
    if (finished && job.channel === "EBAY" && successCount > 0) {
      try {
        // 등록 직후 eBay 실제 결과를 다시 읽을 보고서를 예약한다. 진행 중인
        // 보고서가 있으면 재사용해 API 일일 제한과 중복 요청을 피한다.
        await requestEbayActiveReport(job.userId, true);
      } catch (error) {
        // 상품 등록 성공 자체를 되돌리지는 않는다. 시간별 자동 동기화가 재시도한다.
        safeLog("warn", "ebay.active_report.request_after_publish_failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    // 앞 작업이 끝났으면 줄 선 다음 작업을 바로 깨운다. 1분짜리 정기 실행을
    // 기다리게 두면 사람이 보기에 멈춘 것처럼 보인다.
    const wokeJobId = finished || cancelled
      ? await wakeNextWaitingJob(job.userId, job.channel, job.mode)
      : null;
    return { job: updated, shouldContinue: queued && !stillProcessing, busy: false, wokeJobId };
  } finally {
    await prisma.channelPublishJob.updateMany({
      where: { id: jobId, workerToken },
      data: { workerToken: null, workerLeaseExpiresAt: null },
    });
  }
}

export async function drainChannelPublishJob(jobId: string) {
  // A group is one job item but can contain 40 cards. Never start another group
  // in the remaining time of an invocation. UI polling / independent cron resumes.
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof processChannelPublishJob>> =
    await processChannelPublishJob(jobId, 3);
  // 앞 작업이 끝나며 다음 차례를 깨웠으면 남은 시간으로 이어서 돌린다. 사람이
  // 다시 누르지 않아도 줄이 저절로 흘러가야 한다.
  if (result.wokeJobId && Date.now() - startedAt < 120_000) {
    return drainChannelPublishJob(result.wokeJobId);
  }
  // Cheap price/quantity work uses the remaining invocation in small batches;
  // keep image/group publishing at its original one-batch budget.
  for (let chunk = 1; chunk < 20 && result.shouldContinue && !result.busy &&
    result.job?.channel === "SHOPIFY" && result.job.mode === "PRICE_INVENTORY" &&
    Date.now() - startedAt < 120_000; chunk += 1) {
    result = await processChannelPublishJob(jobId, 3);
  }
  return result;
}

export function isChannelPublishTerminal(status: string) {
  return terminalStatuses.includes(status);
}


export async function retryEbayImageFailures(userId: string, jobId: string, skus?: string[]) {
  return prisma.$transaction(async tx => {
    const job = await tx.channelPublishJob.findFirst({ where: { id: jobId, userId, channel: "EBAY", mode: "IMAGES" } });
    if (!job) throw new Error("eBay 이미지 작업을 찾을 수 없습니다.");
    const activeKey = `${userId}:EBAY:IMAGES`;
    const other = await tx.channelPublishJob.findFirst({ where: { activeKey, id: { not: jobId } }, select: { id: true } });
    if (other) throw new Error("다른 eBay 이미지 작업이 진행 중입니다.");
    const where = { jobId, status: "FAILED", ...(skus ? { sku: { in: skus } } : {}) };
    const items = await tx.channelPublishItem.findMany({ where, select: { id: true, sku: true, error: true, attempts: true } });
    if (!items.length) return { jobId, retried: 0 };
    await tx.syncLog.create({ data: { userId, type: "EBAY_IMAGE_RETRY", status: "SUCCESS", message: `이미지 실패 ${items.length}개 재시도`, rawJson: { jobId, items } } });
    const result = await tx.channelPublishItem.updateMany({ where, data: { status: "QUEUED", attempts: 0, startedAt: null, completedAt: null, error: null } });
    await tx.channelPublishJob.update({ where: { id: jobId }, data: { status: "RUNNING", activeKey, completedAt: null,
      failureCount: { decrement: result.count }, processedCount: { decrement: result.count } } });
    return { jobId, retried: result.count };
  }, { maxWait: 45_000, timeout: 20_000 });
}
