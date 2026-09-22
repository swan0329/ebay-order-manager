import "server-only";
import { withVerifiedProcurementEvidence } from "@/lib/procurement-evidence";
import { reflectEbayInventoryTarget, holdEbayInventoryTarget } from "@/lib/ebay-inventory-reflection";
import { refreshProcurementProduct } from "@/lib/procurement-refresh";
import { selectChangedProducts } from "@/lib/change-product-selection";

import { createHash, randomUUID } from "node:crypto";
import { Prisma, type EbayFeedJob } from "@/generated/prisma";
import {
  buildEbayFeedXml,
  ebayFeedSchemaVersion,
  parseEbayFeedResult,
  type EbayFeedOperation,
  type EbayFeedTarget as Target,
} from "@/lib/ebay-feed-xml";
import { decodeEbayFeedXml } from "@/lib/ebay-feed-file";
import { getOperationalProductIds } from "@/lib/product-operations";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import { prisma } from "@/lib/prisma";
import {
  ebayApiRawRequest,
  ebayApiRequest,
  getActiveEbayInventoryAccount,
} from "@/lib/services/ebayApiService";
import { getEbayVariationMembershipByProductId } from "@/lib/variation-listing-products";
import { requestEbayActiveReport } from "@/lib/ebay-active-report-task";
import { listEbayInventoryTasks } from "@/lib/ebay-active-report-task";
import { syncEbayActiveReport } from "@/lib/ebay-active-report-sync";
import { ensureEbayOutOfStockControl } from "@/lib/ebay-out-of-stock";
import { pendingEbayFeedProgress } from "@/lib/ebay-feed-progress";

const terminalStatuses = new Set(["COMPLETED", "COMPLETED_WITH_ERROR", "FAILED", "CANCELED"]);
const EBAY_MARKETPLACE_HEADERS = { "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };
const UNACCOUNTED_RESULT_MESSAGE = "eBay 결과에서 처리 상태를 확인하지 못했습니다.";

function hasUnaccountedFailures(job: Pick<EbayFeedJob, "failuresJson" | "error">) {
  // An old result with no MessageID cannot always be mapped retroactively.
  // Once its actual error has been surfaced, do not download it every cron run.
  if (job.error?.startsWith("상품별 연결이 불가능한 eBay 오류:") || !Array.isArray(job.failuresJson)) return false;
  return job.failuresJson.some((failure) =>
    failure && typeof failure === "object" && "message" in failure && failure.message === UNACCOUNTED_RESULT_MESSAGE,
  );
}

export async function getEbayFeedOperationTargets(
  userId: string,
  operation: EbayFeedOperation,
  limit?: number,
  knownVariationMembership?: Map<string, string>,
  reconcileProductIds?: string[],
): Promise<Target[]> {
  const reconcile = new Set(reconcileProductIds);
  const variationMembership = knownVariationMembership
    ?? await getEbayVariationMembershipByProductId(userId);
  if (operation === "end") {
    const ids = await getOperationalProductIds("stop_required");
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, ebayItemId: { not: null }, OR: [{ salePrice: { gt: 0 } }, { finalListingPriceUsd: { gt: 0 } }] },
      orderBy: { sku: "asc" },
      take: limit,
    });
    // A variation going out of stock must not end its shared parent listing.
    // It is sent as quantity 0 by the revise operation instead.
    return products.filter((product) => !variationMembership.has(product.id)).map((product) => ({
      productId: product.id,
      sku: product.sku,
      productName: product.productName,
      itemId: product.ebayItemId!,
    }));
  }

  const variationProductIds = [...variationMembership.keys()];
  const [sellableIds, variationStops, settings, latest] = await Promise.all([
    getOperationalProductIds("sellable"),
    prisma.product.findMany({
      where: {
        OR: [
          { ebayItemId: { not: null }, stockQuantity: { lte: 0 }, pocamarketId: { not: null } },
          { id: { in: variationProductIds }, stockQuantity: { lte: 0 }, pocamarketSyncedAt: { not: null }, pocamarketAvailableCount: 0 },
          { ebayItemId: { not: null }, listingStatus: "OUT_OF_STOCK" },
          { AND: [
            { OR: [{ ebayItemId: { not: null } }, { id: { in: variationProductIds } }] },
            { OR: [{ salePrice: null }, { salePrice: { lte: 0 } }] },
            { OR: [{ finalListingPriceUsd: null }, { finalListingPriceUsd: { lte: 0 } }] },
          ] },
        ],
      },
      select: { id: true },
    }),
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
    prisma.ebayReportImport.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!settings) throw new Error("가격 설정을 먼저 저장해 주세요.");
  const variationStopIds = variationStops.map((product) => product.id);
  const ids = [...new Set([...sellableIds, ...variationStopIds])];
  const products = await withVerifiedProcurementEvidence(await prisma.product.findMany({
    where: {
      id: { in: ids },
      OR: [
        {
          ebayItemId: { not: null },
          listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED", "OUT_OF_STOCK"] },
        },
        { id: { in: [...variationMembership.keys()] } },
      ],
    },
    orderBy: { sku: "asc" },
  }));
  const snapshots = latest
    ? await prisma.ebayActiveListing.findMany({
        where: {
          importId: latest.id,
          OR: [
            {
              productId: { in: products.map((product) => product.id) },
              matchStatus: { in: ["MATCHED", "MANUALLY_VERIFIED"] },
            },
            { sku: { in: products.map((product) => product.sku) } },
          ],
        },
      })
    : [];
  const snapshotByProduct = new Map(snapshots.map((snapshot) => [snapshot.productId, snapshot]));
  const snapshotsByExactListing = new Map<string, typeof snapshots>();
  for (const snapshot of snapshots) {
    if (!snapshot.sku) continue;
    const key = `${snapshot.itemId}\u0000${snapshot.sku}`;
    const current = snapshotsByExactListing.get(key) ?? [];
    current.push(snapshot);
    snapshotsByExactListing.set(key, current);
  }
  const inventoryLogs = await prisma.syncLog.findMany({ where: { userId, type: "EBAY_INVENTORY_REFLECTION", status: { in: ["SUCCESS", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 10000, select: { rawJson: true, status: true } });
  const inventoryStates = new Map<string, { itemId: string; price?: string; quantity: number; verified: boolean }>();
  for (const log of inventoryLogs) {
    const value = log.rawJson as { productId?: string; itemId: string; price?: string; quantity: number } | null;
    if (value?.productId && !inventoryStates.has(value.productId)) inventoryStates.set(value.productId, { ...value, verified: log.status === "SUCCESS" });
  }
  const targets = products.flatMap((product) => {
    const variationItemId = variationMembership.get(product.id);
    const targetItemId = variationItemId ?? product.ebayItemId;
    const exactCandidates = targetItemId
      ? snapshotsByExactListing.get(`${targetItemId}\u0000${product.sku}`) ?? []
      : [];
    // Completion verification is about the exact listing that this approved
    // Feed targeted. It does not establish or alter the product connection.
    // An exact, unique Item ID + SKU report row is therefore safe evidence even
    // when the general linking screen keeps duplicate/conflict rows for review.
    const linkedSnapshot = snapshotByProduct.get(product.id);
    const current = exactCandidates.length === 1
      ? exactCandidates[0]
      : linkedSnapshot?.itemId === targetItemId ? linkedSnapshot : undefined;
    const resolved = resolveListingPriceUsd(product, settings);
    // Missing USD price pauses sales even when physical stock remains. Keep
    // the listing identity so entering a price makes it a revise candidate.
    const quantity = resolved ? listingQuantity(product) : 0;
    const price = resolved?.priceUsd.toString();
    // 작업 성공 응답만으로 완료 건수에서 제거하지 않는다. 최신 활성상품 보고서가
    // 실제 eBay 가격·수량을 확인한 경우에만 그 스냅샷을 기준으로 완료 판정한다.
    const baselinePrice = current?.price ?? product.ebayLastSyncedPrice;
    const baselineQuantity = current?.quantity ?? product.ebayLastSyncedQuantity;
    const priceChanged = Boolean(
      price &&
      (baselinePrice === null || baselinePrice === undefined ||
        Math.abs(Number(baselinePrice) - Number(price)) >= 0.01),
    );
    const quantityChanged = baselineQuantity === null ||
      baselineQuantity === undefined || baselineQuantity !== quantity;
    const inventoryState = inventoryStates.get(product.id);
    // ActiveInventoryReport also rewrites ebayLastSynced*; it is not proof
    // that the separate Inventory stock pool was updated.
    const inventoryStateChanged = !inventoryState?.verified || inventoryState.itemId !== (targetItemId ?? current?.itemId) ||
      inventoryState.quantity !== quantity || Boolean(price && (!inventoryState.price || Math.abs(Number(inventoryState.price) - Number(price)) >= 0.01));
    if (
      !reconcile.has(product.id) &&
      !inventoryStateChanged &&
      baselinePrice !== null && baselinePrice !== undefined &&
      baselineQuantity !== null && baselineQuantity !== undefined &&
      (!price || Math.abs(Number(baselinePrice) - Number(price)) < 0.01) &&
      baselineQuantity === quantity
    ) return [];
    return [{
      productId: product.id,
      sku: product.sku,
      productName: product.productName,
      itemId: targetItemId ?? current!.itemId,
      useSku: Boolean(variationItemId),
      price,
      quantity,
      resultStatus: quantity === 0 ? "OUT_OF_STOCK" as const : "ACTIVE" as const,
      priceChanged,
      quantityChanged: quantityChanged || inventoryStateChanged,
      verificationMissing: !current,
    }];
  });
  return limit ? targets.slice(0, limit) : targets;
}

function publicJob(job: EbayFeedJob) {
  const targets = Array.isArray(job.targetsJson) ? (job.targetsJson as Target[]) : [];
  const storedFailures = Array.isArray(job.failuresJson) ? job.failuresJson : [];
  const failures = [...storedFailures, ...targets.filter(target => target.inventoryError && !storedFailures.some(value => value && typeof value === "object" && "productId" in value && value.productId === target.productId)).map(target => ({ productId: target.productId, sku: target.sku, itemId: target.itemId, message: target.inventoryError! }))];
  return {
    id: job.id,
    operation: job.operation,
    feedType: job.feedType,
    status: job.status,
    totalCount: job.totalCount,
    successCount: job.successCount,
    failureCount: Math.max(job.failureCount, failures.length),
    error: job.error,
    submittedAt: job.submittedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    targets: targets.map(({ productId, sku, productName, itemId, price, quantity }) => ({ productId, sku, productName, itemId, price, quantity })),
    failures,
  };
}

export async function listEbayFeedJobs(userId: string, sku?: string) {
  const jobs = await prisma.ebayFeedJob.findMany({ where: { userId, ...(sku ? { targetsJson: { array_contains: [{ sku }] } } : {}) }, orderBy: { createdAt: "desc" }, take: sku ? 100 : 20 });
  return jobs.map(publicJob);
}

export async function diagnoseEbayFeedJob(userId: string, jobId: string) {
  const job = await prisma.ebayFeedJob.findFirst({ where: { id: jobId, userId } });
  if (!job?.ebayTaskId) throw new Error("eBay 작업을 찾을 수 없습니다.");
  const account = await getActiveEbayInventoryAccount(userId);
  const file = await ebayApiRawRequest(account, {
    path: `/sell/feed/v1/task/${encodeURIComponent(job.ebayTaskId)}/download_result_file`, responseType: "buffer",
  });
  const parsed = parseEbayFeedResult(decodeEbayFeedXml(file.body), job.targetsJson as unknown as Target[]);
  return { job: publicJob(job), responseCount: parsed.responseCount, succeeded: [...parsed.succeeded], failures: parsed.failures, unmatchedErrors: parsed.unmatchedErrors };
}

export async function verifyEbayFeedJob(userId: string, jobId: string) {
  const job = await prisma.ebayFeedJob.findFirst({ where: { id: jobId, userId } });
  if (!job?.completedAt) throw new Error("완료된 eBay 작업만 검증할 수 있습니다.");
  const sync = await syncEbayActiveReport(userId);
  const report = await prisma.ebayReportImport.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  const { tasks } = await listEbayInventoryTasks(userId);
  const reportTask = tasks.find((task) => report?.fileName === `ebay-feed-active-task-${task.taskId}`);
  const fresh = Boolean(reportTask?.creationDate && Date.parse(reportTask.creationDate) >= job.completedAt.getTime());
  const targets = job.targetsJson as unknown as Target[];
  const rows = report ? await prisma.ebayActiveListing.findMany({ where: { importId: report.id, itemId: { in: targets.map((target) => target.itemId) } } }) : [];
  const checks = targets.map((target) => {
    const matches = rows.filter((row) => row.itemId === target.itemId && (target.useSku === false || row.sku === target.sku));
    const observed = matches.length === 1 ? matches[0] : null;
    const verified = fresh && (job.operation === "end" ? matches.length === 0 : Boolean(observed &&
      (!target.price || Math.abs(Number(observed.price) - Number(target.price)) < 0.01) && observed.quantity === target.quantity));
    return { sku: target.sku, itemId: target.itemId, expectedPrice: target.price, expectedQuantity: target.quantity,
      observedPrice: observed?.price, observedQuantity: observed?.quantity, verified };
  });
  return { jobId, reportId: report?.id, reportCreatedAt: reportTask?.creationDate, fresh, sync, checks };
}

export async function submitEbayFeedOperation(userId: string, operation: EbayFeedOperation, limit?: number, retryJobId?: string, productIds?: string[]) {
  // Explicit small selections can recheck immediately. Bulk expired products
  // are held by the shared resolver and refreshed by the durable source queue.
  if (operation === "revise" && productIds?.length && productIds.length <= 10) {
    const selected = await prisma.product.findMany({ where: { id: { in: productIds } } });
    for (const product of selected) await refreshProcurementProduct(product, userId);
  }
  // A deliberate small selection is also a repair request. Stored reports can
  // disagree with GetItem; do not let an old successful snapshot suppress it.
  let targets = await getEbayFeedOperationTargets(userId, operation, retryJobId || productIds !== undefined ? undefined : limit,
    undefined, productIds && productIds.length <= 10 ? productIds : undefined);
  targets = selectChangedProducts(targets, productIds, target => target.productId);
  if (productIds !== undefined && limit) targets = targets.slice(0, limit);
  if (retryJobId) {
    const original = await prisma.ebayFeedJob.findFirst({ where: { id: retryJobId, userId, operation } });
    if (!original?.completedAt || !Array.isArray(original.failuresJson)) throw new Error("재시도할 완료 작업을 찾을 수 없습니다.");
    const failures = original.failuresJson as unknown as Array<{ productId: string; itemId: string }>;
    targets = targets.filter((target) => failures.some((failure) => failure.productId === target.productId && failure.itemId === target.itemId));
    if (limit) targets = targets.slice(0, limit);
  }
  if (!targets.length) throw new Error(operation === "end" ? "판매중단할 상품이 없습니다." : "eBay에 반영할 가격·수량 변경이 없습니다.");
  const feedType = operation === "end" ? "LMS_END_FIXED_PRICE_ITEM" : "LMS_REVISE_INVENTORY_STATUS";
  const verificationBaseline = await prisma.ebayReportImport.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  // 같은 보고서를 기준으로 한 중복 클릭은 재사용하되, 새 보고서에서도 불일치가
  // 확인되면 새 작업으로 안전하게 재시도할 수 있어야 한다.
  const fingerprint = createHash("sha256").update(JSON.stringify({
    operation,
    targets,
    verificationReportId: verificationBaseline?.id ?? null,
  })).digest("hex");
  const idempotencyKey = `${userId}:${operation}:${fingerprint}`;
  let job = await prisma.ebayFeedJob.upsert({
    where: { idempotencyKey },
    update: {},
    create: { userId, idempotencyKey, operation, feedType, totalCount: targets.length, targetsJson: targets as unknown as Prisma.InputJsonValue },
  });
  // A submission can fail before eBay assigns a task ID (for example, a
  // rejected createTask request). Let the same verified target set be retried
  // after the request problem is corrected without creating a duplicate job.
  if (!job.ebayTaskId && job.status === "FAILED") {
    await prisma.ebayFeedJob.updateMany({
      where: { id: job.id, ebayTaskId: null, status: "FAILED" },
      data: { status: "PENDING", error: null, completedAt: null },
    });
    job = await prisma.ebayFeedJob.findUniqueOrThrow({ where: { id: job.id } });
  }
  if (job.ebayTaskId || job.status !== "PENDING") {
    if (job.ebayTaskId && hasUnaccountedFailures(job)) return refreshEbayFeedJob(userId, job.id);
    return publicJob(job);
  }
  const claimed = await prisma.ebayFeedJob.updateMany({ where: { id: job.id, status: "PENDING", ebayTaskId: null }, data: { status: "SUBMITTING" } });
  if (!claimed.count) return publicJob(await prisma.ebayFeedJob.findUniqueOrThrow({ where: { id: job.id } }));

  try {
    const account = await getActiveEbayInventoryAccount(userId);
    if (operation === "revise") {
      await ensureEbayOutOfStockControl(account);
    }
    const created = await ebayApiRequest(account, {
      method: "POST",
      path: "/sell/feed/v1/task",
      headers: EBAY_MARKETPLACE_HEADERS,
      body: { feedType, schemaVersion: ebayFeedSchemaVersion },
    });
    const location = created.headers.get("location");
    const bodyTaskId = created.body && typeof created.body === "object" ? String((created.body as { taskId?: unknown }).taskId ?? "") : "";
    const taskId = location?.split("/").filter(Boolean).at(-1) ?? bodyTaskId;
    if (!taskId) throw new Error("eBay가 작업 ID를 반환하지 않았습니다.");
    await prisma.ebayFeedJob.update({ where: { id: job.id }, data: { ebayTaskId: taskId, status: "CREATED" } });
    const form = new FormData();
    // The asynchronous feed may run after source cost changes. It may hold
    // stock, but only current-price read-back in reflection may reopen it.
    const submittedTargets = operation === "revise" ? targets.map(target => ({ ...target, quantity: 0 })) : targets;
    form.set("file", new Blob([buildEbayFeedXml(operation, submittedTargets)], { type: "application/xml" }), `${operation}-${job.id}.xml`);
    await ebayApiRawRequest(account, {
      method: "POST",
      path: `/sell/feed/v1/task/${encodeURIComponent(taskId)}/upload_file`,
      headers: EBAY_MARKETPLACE_HEADERS,
      body: form,
    });
    return publicJob(await prisma.ebayFeedJob.update({ where: { id: job.id }, data: { status: "SUBMITTED", submittedAt: new Date() } }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "eBay 자동 작업 제출 실패";
    await prisma.ebayFeedJob.update({ where: { id: job.id }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    throw new Error(message);
  }
}

async function applyCompletedJob(jobId: string, resultXml: string, summary: { successCount?: number; failureCount?: number }) {
  const job = await prisma.ebayFeedJob.findUniqueOrThrow({ where: { id: jobId } });
  const targets = job.targetsJson as unknown as Target[];
  const parsed = parseEbayFeedResult(resultXml, targets);
  if (!parsed.responseCount && Number(summary.successCount ?? 0) === targets.length && Number(summary.failureCount ?? 0) === 0) {
    targets.forEach((target) => parsed.succeeded.add(target.productId));
  }
  if (!parsed.responseCount && parsed.succeeded.size !== targets.length) {
    throw new Error("eBay 결과 파일에서 개별 처리 응답을 읽지 못했습니다. 다음 자동 확인에서 다시 처리합니다.");
  }
  const unaccounted = targets.filter((target) => !parsed.succeeded.has(target.productId) && !parsed.failures.some((failure) => failure.productId === target.productId));
  parsed.failures.push(...unaccounted.map((target) => ({ productId: target.productId, sku: target.sku, itemId: target.itemId, message: UNACCOUNTED_RESULT_MESSAGE })));
  if (job.operation === "revise") {
    const account = await getActiveEbayInventoryAccount(job.userId);
    const pricing = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
    const pending = targets.filter(target => !target.inventoryApplied && !target.inventoryError);
    // 변동처리는 먼저 모든 대상의 수량을 0으로 보내고, 여기서 실제 수량을 되돌린다.
    // 되돌리기 전까지 상품은 eBay에서 품절로 보인다. 그래서 한 번에 최대한 많이
    // 처리하고, 실제 중단은 아래 150초 시간 예산이 맡는다. 25개로 묶어 두면 큰
    // 작업에서 복구가 몇 시간씩 걸린다.
    const chunk = pending.slice(0, 400);
    const currentProducts = await withVerifiedProcurementEvidence(await prisma.product.findMany({ where: { id: { in: chunk.map(target => target.productId) } } }));
    const currentById = new Map(currentProducts.map(product => [product.id, product]));
    const started = Date.now();
    for (const target of chunk) {
      if (Date.now() - started > 150_000) break;
      let reflectionAttempted = false;
      try {
        if (!parsed.succeeded.has(target.productId)) throw new Error("eBay Feed 반영 실패·응답 누락으로 판매 보류가 필요합니다.");
        const current = currentById.get(target.productId);
        if (!current) throw new Error("연결된 내부 상품을 찾을 수 없습니다.");
        const resolved = resolveListingPriceUsd(current, pricing ?? undefined);
        const currentPrice = resolved?.priceUsd.toString();
        const currentQuantity = resolved ? listingQuantity(current) : 0;
        target.price = currentPrice;
        target.quantity = currentQuantity;
        reflectionAttempted = true;
        const reflected = await reflectEbayInventoryTarget(account, target);
        await prisma.syncLog.create({ data: { userId: job.userId, type: "EBAY_INVENTORY_REFLECTION", status: "SUCCESS",
          message: `${target.sku}: Inventory 가격·수량 반영`, rawJson: { jobId: job.id, productId: target.productId, itemId: target.itemId, quantity: target.quantity,
            ...(target.price ? { price: target.price } : {}), legacy: reflected.legacy } } });
        target.inventoryApplied = true;
      } catch (error) {
        target.inventoryError = error instanceof Error ? error.message : "eBay Inventory 반영 실패";
        if (!reflectionAttempted) {
          try {
            await holdEbayInventoryTarget(account, target);
            target.inventoryError += " 해당 옵션 판매 수량 0 확인 완료";
          } catch { target.inventoryError += " 판매 보류 미확인·재시도 필요"; }
        }
        // A failed real-world verification supersedes any older success for
        // the same values; otherwise matching report data could hide it again.
        await prisma.syncLog.create({ data: { userId: job.userId, type: "EBAY_INVENTORY_REFLECTION", status: "FAILED",
          message: `${target.sku}: 실제 가격·수량 반영 검증 실패`, rawJson: { jobId: job.id, productId: target.productId,
            itemId: target.itemId, quantity: target.quantity ?? 0, ...(target.price ? { price: target.price } : {}) } } });
      }
      // Each idempotent absolute-quantity write is checkpointed. A crash retries
      // at most the current SKU, not the whole 500-product operation.
      await prisma.ebayFeedJob.update({ where: { id: job.id }, data: { targetsJson: targets as unknown as Prisma.InputJsonValue } });
    }
    const remaining = targets.some(target => !target.inventoryApplied && !target.inventoryError);
    if (remaining) {
      await prisma.ebayFeedJob.update({ where: { id: job.id }, data: { status: "IN_PROCESS", completedAt: null,
        successCount: targets.filter(target => target.inventoryApplied).length,
        error: "eBay Inventory 가격·수량 반영을 계속 확인하고 있습니다." } });
      return;
    }
    for (const target of targets.filter(target => target.inventoryError)) {
      parsed.succeeded.delete(target.productId);
      parsed.failures = parsed.failures.filter(failure => failure.productId !== target.productId);
      parsed.failures.push({ productId: target.productId, sku: target.sku, itemId: target.itemId, message: target.inventoryError! });
    }
  }
  const successfulProductIds = [...parsed.succeeded];
  const failureIdsByMessage = new Map<string, string[]>();
  for (const failure of parsed.failures) {
    const ids = failureIdsByMessage.get(failure.message) ?? [];
    ids.push(failure.productId);
    failureIdsByMessage.set(failure.message, ids);
  }
  // Feed files commonly contain hundreds of rows. Do not keep an interactive
  // transaction open while issuing one UPDATE per product: Prisma closes that
  // transaction after its short timeout. Collapse identical outcomes into
  // updateMany statements and commit them with the job result as one batch.
  const productUpdates = [
    ...([0, 1] as const).flatMap(kind => {
      const ids = targets.filter(target => parsed.succeeded.has(target.productId) &&
        job.operation === "revise" && (kind === 0 ? target.quantity === 0 : (target.quantity ?? 0) > 0))
        .map(target => target.productId);
      return ids.length ? [prisma.product.updateMany({ where: { id: { in: ids } },
        data: { listingStatus: kind === 0 ? "OUT_OF_STOCK" : "ACTIVE" } })] : [];
    }),
    ...(successfulProductIds.length ? [prisma.product.updateMany({
      where: { id: { in: successfulProductIds } },
      data: {
        uploadError: null,
        uploadErrorSummary: null,
        uploadRawError: Prisma.JsonNull,
      },
    })] : []),
    ...[...failureIdsByMessage.entries()].map(([message, productIds]) =>
      prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { uploadError: message, uploadErrorSummary: message },
      })),
  ];
  await prisma.$transaction([
    ...productUpdates,
    prisma.ebayFeedJob.update({
      where: { id: job.id },
      data: {
        status: parsed.failures.length ? "COMPLETED_WITH_ERROR" : "COMPLETED",
        successCount: parsed.succeeded.size,
        failureCount: parsed.failures.length,
        failuresJson: parsed.failures as unknown as Prisma.InputJsonValue,
        error: parsed.unmatchedErrors.length
          ? `상품별 연결이 불가능한 eBay 오류: ${parsed.unmatchedErrors.join(" / ")}`
          : null,
        completedAt: new Date(),
      },
    }),
  ]);

  // Feed 결과는 요청 처리 결과이고 최종 채널 상태의 증거는 아니다. 성공 직후 새
  // 활성상품 보고서를 요청하고, 그 보고서가 들어올 때 작업 대상 수가 줄어든다.
  try {
    await requestEbayActiveReport(job.userId, true);
  } catch (error) {
    await prisma.ebayFeedJob.update({
      where: { id: job.id },
      data: {
        error: `eBay 변경 요청은 처리됐지만 실제 결과 확인 보고서를 요청하지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      },
    });
  }
}

export async function refreshEbayFeedJob(userId: string, jobId: string) {
  let job = await prisma.ebayFeedJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new Error("eBay 작업을 찾을 수 없습니다.");
  if (
    !job.ebayTaskId ||
    (["COMPLETED", "COMPLETED_WITH_ERROR", "FAILED", "CANCELED"].includes(job.status) && job.completedAt && !hasUnaccountedFailures(job))
  ) return publicJob(job);
  const refreshToken = randomUUID();
  const claimed = await prisma.ebayFeedJob.updateMany({
    where: {
      id: job.id,
      userId,
      OR: [
        { refreshLeaseExpiresAt: null },
        { refreshLeaseExpiresAt: { lt: new Date() } },
      ],
    },
    data: {
      refreshToken,
      refreshLeaseExpiresAt: new Date(Date.now() + 300_000),
    },
  });
  if (!claimed.count) return publicJob(job);

  try {
    const account = await getActiveEbayInventoryAccount(userId);
    const result = await ebayApiRequest(account, { path: `/sell/feed/v1/task/${encodeURIComponent(job.ebayTaskId)}` });
    const statusBody = result.body && typeof result.body === "object" ? result.body as { status?: string; uploadSummary?: { successCount?: number; failureCount?: number } } : {};
    const externalStatus = String(statusBody.status ?? "IN_PROGRESS").toUpperCase();
    await prisma.ebayFeedJob.update({ where: { id: job.id }, data: {
      ...pendingEbayFeedProgress(externalStatus, job),
      externalStatus: statusBody as unknown as Prisma.InputJsonValue,
    } });
    if (terminalStatuses.has(externalStatus)) {
      if (externalStatus === "COMPLETED" || externalStatus === "COMPLETED_WITH_ERROR") {
        const file = await ebayApiRawRequest(account, {
          path: `/sell/feed/v1/task/${encodeURIComponent(job.ebayTaskId)}/download_result_file`,
          responseType: "buffer",
        });
        await applyCompletedJob(job.id, decodeEbayFeedXml(file.body), statusBody.uploadSummary ?? {});
      } else {
        await prisma.ebayFeedJob.update({ where: { id: job.id }, data: { status: externalStatus, error: `eBay 작업이 ${externalStatus} 상태로 종료되었습니다.`, completedAt: new Date() } });
      }
    }
    job = await prisma.ebayFeedJob.findUniqueOrThrow({ where: { id: job.id } });
    return publicJob(job);
  } finally {
    await prisma.ebayFeedJob.updateMany({
      where: { id: job.id, refreshToken },
      data: { refreshToken: null, refreshLeaseExpiresAt: null },
    });
  }
}

export async function recoverIncompleteEbayFeedJobs(userId: string) {
  const jobs = await prisma.ebayFeedJob.findMany({
    where: {
      userId,
      ebayTaskId: { not: null },
      status: { in: ["COMPLETED", "COMPLETED_WITH_ERROR", "IN_PROCESS", "IN_PROGRESS", "SUBMITTED", "CREATED"] },
    },
    // Recover the operation the user just ran first. Historical completed jobs
    // must not push a recent archive-decoding failure out of this bounded scan.
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  // 수량 복구가 밀린 작업이 여러 건일 수 있다. 한 번에 하나만 집으면 품절 상태가
  // 그만큼 길어진다. 각 작업이 자체 시간 예산 안에서 멈추므로 몇 건은 안전하다.
  const recoverable = jobs.filter((job) => !job.completedAt || hasUnaccountedFailures(job)).slice(0, 3);
  // 한 번의 실행 안에서만 이어 간다. 작업마다 자체 시간 예산이 있으므로 남은 시간이
  // 없으면 다음 작업은 다음 실행에 맡긴다.
  const deadline = Date.now() + 200_000;
  let recovered = 0;
  for (const job of recoverable) {
    if (Date.now() > deadline) break;
    await refreshEbayFeedJob(userId, job.id);
    recovered += 1;
  }
  return recovered;
}
