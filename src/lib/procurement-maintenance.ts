import { prisma } from "@/lib/prisma";
import { createPocamarketSyncBatch, getPocamarketSyncSettings } from "@/lib/pocamarket-sync";
import { getEbayFeedOperationTargets, submitEbayFeedOperation } from "@/lib/ebay-feed-operations";
import { createChannelPublishJob, createShopifyAutomaticOperationJob, getShopifyAutomaticOperationProductIds } from "@/lib/channel-publish-jobs";
import { getChannelImageChanges } from "@/lib/channel-image-changes";
import { procurementHoldReason, procurementRefreshDue } from "@/lib/procurement-freshness";
import { withVerifiedProcurementEvidence } from "@/lib/procurement-evidence";
import { shouldPauseAutoSchedule } from "@/lib/channel-auto-backoff";

export async function ensureProcurementRefreshQueue(userId?: string) {
  const owner = userId ?? (await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!owner || !(await getPocamarketSyncSettings(owner)).enabled) return null;
  if (await prisma.pocamarketSyncBatch.findFirst({ where: { userId: owner, status: { in: ["QUEUED", "RUNNING", "PAUSED"] } }, select: { id: true } })) return null;
  try { return await createPocamarketSyncBatch(owner, 250, { activeOnly: true }); }
  catch (error) {
    if (error instanceof Error && /최신화할 등록 상품이 없습니다|이미 진행 중/.test(error.message)) return null;
    throw error;
  }
}

// Authorized ongoing price/supply reflection. Uses the existing durable channel
// jobs, never purchases, changes owned inventory, or schedules image replacement.
export async function maintainProcurementChannels() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin || !(await getPocamarketSyncSettings(admin.id)).enabled) return;
  // 채널에 올라가 있는 상품이면 모두 자동 반영한다. 예전에는 포카마켓에 연결된 것만
  // 봤는데, 그러면 보유 재고로만 파는 상품은 사람이 변동처리를 눌러야 반영됐다.
  // 어떤 가격·수량을 보낼지는 상품마다 기존 판정이 그대로 정한다.
  const linked = await prisma.product.findMany({ where: {
    OR: [{ ebayItemId: { not: null } }, { shopifyProductId: { not: null } }] }, select: { id: true } });
  const ids = new Set(linked.map(product => product.id));
  const failures: string[] = [];
  try {
    const ebayActive = await prisma.ebayFeedJob.findFirst({ where: { userId: admin.id, status: { in: ["PENDING", "SUBMITTING", "CREATED", "SUBMITTED", "IN_PROCESS"] } }, select: { id: true } });
    // 실패한 원인이 그대로면 5분 뒤에 걸어도 또 실패한다. eBay 호출만 태우므로 쉰다.
    const lastFailed = await prisma.ebayFeedJob.findFirst({
      where: { userId: admin.id, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, completedAt: true, error: true },
    });
    const paused = shouldPauseAutoSchedule(
      lastFailed ? { at: lastFailed.completedAt ?? lastFailed.createdAt, error: lastFailed.error } : null,
    );
    if (!ebayActive && !paused) {
      // 가격·수량 되돌리기가 먼저다. 판매중단은 그다음 주기에 건다.
      const targets = (await getEbayFeedOperationTargets(admin.id, "revise")).filter(target => ids.has(target.productId)).slice(0, 500);
      if (targets.length) await submitEbayFeedOperation(admin.id, "revise", 500, undefined, targets.map(target => target.productId));
      else {
        const stopping = (await getEbayFeedOperationTargets(admin.id, "end")).filter(target => ids.has(target.productId)).slice(0, 500);
        if (stopping.length) await submitEbayFeedOperation(admin.id, "end", 500, undefined, stopping.map(target => target.productId));
      }
    }
  } catch { failures.push("eBay"); }
  try {
    const shopifyActive = await prisma.channelPublishJob.findFirst({ where: { userId: admin.id, channel: "SHOPIFY", mode: { in: ["PRICE_INVENTORY", "ARCHIVE"] }, status: { in: ["QUEUED", "RUNNING", "WAITING"] } }, select: { id: true } });
    if (!shopifyActive) {
      const targets = (await getShopifyAutomaticOperationProductIds("revise")).filter(product => ids.has(product.id)).slice(0, 500);
      if (targets.length) await createShopifyAutomaticOperationJob({ userId: admin.id, operation: "revise", limit: 500, productIds: targets.map(product => product.id) });
      else {
        const stopping = (await getShopifyAutomaticOperationProductIds("end")).filter(product => ids.has(product.id)).slice(0, 500);
        if (stopping.length) await createShopifyAutomaticOperationJob({ userId: admin.id, operation: "end", limit: 500, productIds: stopping.map(product => product.id) });
      }
    }
  } catch { failures.push("Shopify"); }
  // 이미지 변동도 사람이 누르지 않아도 반영한다. 가격·수량과 다른 큐를 쓰므로
  // 서로 밀어내지 않는다. 신규등록만 사람이 직접 실행한다.
  for (const channel of ["EBAY", "SHOPIFY"] as const) {
    try {
      const running = await prisma.channelPublishJob.findFirst({
        where: { userId: admin.id, channel, mode: "IMAGES", status: { in: ["QUEUED", "RUNNING", "WAITING"] } },
        select: { id: true },
      });
      if (running) continue;
      const changes = (await getChannelImageChanges(admin.id, channel)).filter(change => ids.has(change.productId));
      if (!changes.length) continue;
      await createChannelPublishJob({
        userId: admin.id,
        channel,
        mode: "IMAGES",
        targetIds: changes.slice(0, 500).map(change => change.productId),
      });
    } catch { failures.push(`${channel} 이미지`); }
  }
  if (failures.length) throw new Error(`${failures.join(" · ")} 조달 변동 예약 실패`);
}

export async function getProcurementSafetySummary() {
  const products = await prisma.product.findMany({ where: {
    pocamarketId: { not: null },
    OR: [
      { ebayItemId: { not: null }, listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED", "OUT_OF_STOCK"] } },
      { shopifyProductId: { not: null }, shopifyStatus: { notIn: ["ARCHIVED", "archived", "DRAFT", "draft"] } },
    ],
  }, select: { id: true, pocamarketAvailableCount: true, stockQuantity: true, salePrice: true, ebayPrice: true, ebayLastSyncedPrice: true, lastUploadedAt: true, sku: true, pocamarketId: true, pocamarketSyncedAt: true, pocamarketLastAttemptAt: true } });
  const verified = await withVerifiedProcurementEvidence(products);
  const evidenceMismatch = products.filter((product, index) => verified[index] !== product);
  const held = products.filter(product => procurementHoldReason(product));
  return { refreshHours: 6, maxAgeHours: 24, total: products.length,
    evidenceMatched: products.length - evidenceMismatch.length, evidenceMismatch: evidenceMismatch.length,
    evidenceMismatchSkus: evidenceMismatch.map(product => product.sku),
    due: products.filter(product => procurementRefreshDue(product)).length, held: held.length,
    failures: held.filter(product => product.pocamarketLastAttemptAt && product.pocamarketLastAttemptAt > (product.pocamarketSyncedAt ?? new Date(0))).length,
    samples: held.slice(0, 20).map(product => ({ sku: product.sku, reason: procurementHoldReason(product) })),
  };
}
