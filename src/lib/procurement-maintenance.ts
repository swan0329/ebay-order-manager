import { prisma } from "@/lib/prisma";
import { createPocamarketSyncBatch, getPocamarketSyncSettings } from "@/lib/pocamarket-sync";
import { getEbayFeedOperationTargets, submitEbayFeedOperation } from "@/lib/ebay-feed-operations";
import { createShopifyAutomaticOperationJob, getShopifyAutomaticOperationProductIds } from "@/lib/channel-publish-jobs";
import { procurementHoldReason, procurementRefreshDue } from "@/lib/procurement-freshness";
import { withVerifiedProcurementEvidence } from "@/lib/procurement-evidence";

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
  const linked = await prisma.product.findMany({ where: { pocamarketId: { not: null },
    OR: [{ ebayItemId: { not: null } }, { shopifyProductId: { not: null } }] }, select: { id: true } });
  const ids = new Set(linked.map(product => product.id));
  const failures: string[] = [];
  try {
    const ebayActive = await prisma.ebayFeedJob.findFirst({ where: { userId: admin.id, status: { in: ["PENDING", "SUBMITTING", "CREATED", "SUBMITTED", "IN_PROCESS"] } }, select: { id: true } });
    if (!ebayActive) {
      const targets = (await getEbayFeedOperationTargets(admin.id, "revise")).filter(target => ids.has(target.productId)).slice(0, 500);
      if (targets.length) await submitEbayFeedOperation(admin.id, "revise", 500, undefined, targets.map(target => target.productId));
    }
  } catch { failures.push("eBay"); }
  try {
    const shopifyActive = await prisma.channelPublishJob.findFirst({ where: { userId: admin.id, channel: "SHOPIFY", mode: "PRICE_INVENTORY", status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
    if (!shopifyActive) {
      const targets = (await getShopifyAutomaticOperationProductIds("revise")).filter(product => ids.has(product.id)).slice(0, 500);
      if (targets.length) await createShopifyAutomaticOperationJob({ userId: admin.id, operation: "revise", limit: 500, productIds: targets.map(product => product.id) });
    }
  } catch { failures.push("Shopify"); }
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
