import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  fetchPocamarketProductState,
  loadPocamarketApiConfig,
  PocamarketBlockingError,
  PocamarketSchemaError,
  randomDelayMs,
} from "@/lib/pocamarket-api-collector";
import { reconcileAiImageJobsForSupply } from "@/lib/ai-image-work";

export const DEFAULT_POCAMARKET_BATCH_SIZE = 1_000;
export const MAX_POCAMARKET_BATCH_SIZE = 10_000;

export const pocamarketSpeedProfiles = {
  AUTO: { minDelayMs: 1000, maxDelayMs: 3000, pageWaitMs: 0 },
  FAST: { minDelayMs: 1000, maxDelayMs: 1500, pageWaitMs: 0 },
  BALANCED: { minDelayMs: 1000, maxDelayMs: 3000, pageWaitMs: 0 },
  SAFE: { minDelayMs: 3000, maxDelayMs: 5000, pageWaitMs: 0 },
} as const;

const eligibleProductWhere = {
  pocamarketId: { not: null },
};

export async function getPocamarketSyncSummary(
  dailyBatchSize = DEFAULT_POCAMARKET_BATCH_SIZE,
) {
  const normalizedDailyBatchSize = normalizePocamarketBatchSize(dailyBatchSize);
  const allProducts = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      productName: true,
      status: true,
      pocamarketId: true,
      pocamarketLastAttemptAt: true,
      pocamarketSyncedAt: true,
    },
    orderBy: { sku: "asc" },
  });
  const products = allProducts.filter((product) =>
    /^\d+$/.test(product.pocamarketId?.trim() ?? ""),
  );
  const excludedProducts = allProducts
    .filter((product) => !/^\d+$/.test(product.pocamarketId?.trim() ?? ""))
    .slice(0, 50)
    .map((product) => ({
      id: product.id,
      sku: product.sku,
      productName: product.productName,
      pocamarketId: product.pocamarketId,
      reason: product.pocamarketId?.trim()
        ? "포카마켓 상품번호가 숫자 형식이 아님"
        : "포카마켓 상품번호 없음",
    }));
  const totalCount = products.length;
  const neverAttemptedCount = products.filter(
    (product) => !product.pocamarketLastAttemptAt,
  ).length;
  const successfullySyncedCount = products.filter(
    (product) => Boolean(product.pocamarketSyncedAt),
  ).length;

  return {
    totalProductCount: allProducts.length,
    totalCount,
    invalidIdCount: allProducts.filter(
      (product) =>
        Boolean(product.pocamarketId?.trim()) &&
        !/^\d+$/.test(product.pocamarketId?.trim() ?? ""),
    ).length,
    missingIdCount: allProducts.filter(
      (product) => !product.pocamarketId?.trim(),
    ).length,
    nonActiveIncludedCount: products.filter(
      (product) => product.status.toLowerCase() !== "active",
    ).length,
    neverAttemptedCount,
    successfullySyncedCount,
    needsAttentionCount: Math.max(
      0,
      totalCount - neverAttemptedCount - successfullySyncedCount,
    ),
    nextBatchCount: Math.min(normalizedDailyBatchSize, totalCount),
    estimatedCycleDays: Math.max(
      1,
      Math.ceil(totalCount / normalizedDailyBatchSize),
    ),
    excludedProducts,
  };
}

export async function getPocamarketSyncSettings(userId: string) {
  return prisma.pocamarketSyncSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function ensureScheduledPocamarketSync(expectedHour?: number) {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) return null;
  const settings = await getPocamarketSyncSettings(admin.id);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;

  if (
    !settings.enabled ||
    settings.lastScheduledDate === date ||
    (expectedHour !== undefined && settings.scheduledHour !== expectedHour)
  ) {
    return { settings, created: false };
  }
  try {
    const batch = await createPocamarketSyncBatch(
      admin.id,
      settings.dailyBatchSize,
    );
    await prisma.pocamarketSyncSettings.update({
      where: { userId: admin.id },
      data: { lastScheduledDate: date },
    });
    return { settings, created: true, batchId: batch.id };
  } catch (error) {
    if (error instanceof Error && error.message.includes("진행 중")) {
      return { settings, created: false };
    }
    throw error;
  }
}

export function normalizePocamarketBatchSize(requestedLimit?: number) {
  const limit = requestedLimit ?? DEFAULT_POCAMARKET_BATCH_SIZE;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_POCAMARKET_BATCH_SIZE
  ) {
    throw new Error(
      `최신화 개수는 1개 이상 ${MAX_POCAMARKET_BATCH_SIZE.toLocaleString()}개 이하로 입력해 주세요.`,
    );
  }
  return limit;
}

export async function createPocamarketSyncBatch(
  userId: string,
  requestedLimit?: number,
  options?: { onlyUnsynced?: boolean },
) {
  const onlyUnsynced = options?.onlyUnsynced ?? false;
  const active = await prisma.pocamarketSyncBatch.findFirst({
    where: { userId, status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
    select: { id: true },
  });
  if (active) throw new Error("이미 진행 중인 포카마켓 최신화 작업이 있습니다.");

  const settings = await getPocamarketSyncSettings(userId);
  const recentChangedIds =
    settings.priorityStrategy === "PRICE_CHANGED"
      ? new Set(
          (
            await prisma.pocamarketSyncItem.findMany({
              where: {
                status: { in: ["CHANGED", "ANOMALY", "SOLD_OUT"] },
                createdAt: {
                  gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              },
              distinct: ["productId"],
              select: { productId: true },
            })
          ).map((item) => item.productId),
        )
      : new Set<string>();
  const candidates = (await prisma.product.findMany({
    where: eligibleProductWhere,
    select: {
      id: true,
      pocamarketId: true,
      salePrice: true,
      isSoldOut: true,
      pocamarketAvailableCount: true,
      pocamarketLastAttemptAt: true,
      pocamarketSyncedAt: true,
    },
  }))
    .filter((product) => /^\d+$/.test(product.pocamarketId ?? ""))
    // "확인 필요만"일 때는 아직 정상 반영되지 않은(한 번도 성공 못 한) 상품만 남긴다.
    .filter((product) => (onlyUnsynced ? product.pocamarketSyncedAt === null : true));
  // 확인 필요만 돌릴 때는 개수 입력 없이 대상 전체를 담되 안전 상한(MAX)까지만 처리한다.
  const batchSize =
    onlyUnsynced && requestedLimit === undefined
      ? Math.min(MAX_POCAMARKET_BATCH_SIZE, Math.max(1, candidates.length))
      : normalizePocamarketBatchSize(requestedLimit);
  const timestamp = (value: Date | null) => value?.getTime() ?? 0;
  const priority = (product: (typeof candidates)[number]) => {
    if (settings.priorityStrategy === "MISSING_PRICE") {
      return product.salePrice === null ? 1 : 0;
    }
    if (settings.priorityStrategy === "NEVER_SYNCED") {
      return product.pocamarketSyncedAt === null ? 0 : 1;
    }
    if (settings.priorityStrategy === "PRICE_CHANGED") {
      return recentChangedIds.has(product.id) ? 0 : 1;
    }
    if (settings.priorityStrategy === "SMART") {
      if (product.salePrice === null) return 2;
      if (product.pocamarketSyncedAt === null) return 0;
      return 1;
    }
    return 0;
  };
  const products = candidates
    .sort(
      (left, right) =>
        priority(left) - priority(right) ||
        timestamp(left.pocamarketLastAttemptAt) -
          timestamp(right.pocamarketLastAttemptAt) ||
        (left.pocamarketId ?? "").localeCompare(right.pocamarketId ?? ""),
    )
    .slice(0, batchSize);
  if (!products.length) {
    throw new Error(
      onlyUnsynced
        ? "최신화가 필요한(확인 필요) 상품이 없습니다."
        : "최신화할 등록 상품이 없습니다.",
    );
  }

  return prisma.pocamarketSyncBatch.create({
    data: {
      userId,
      totalCount: products.length,
      items: {
        create: products.map((product) => ({
          productId: product.id,
          productNumber: product.pocamarketId!,
          previousPrice: product.salePrice,
          previousAvailableCount: product.pocamarketAvailableCount,
          previousIsSoldOut: product.isSoldOut,
        })),
      },
    },
    include: { items: true },
  });
}

export async function nextPocamarketSyncItem(deviceSerial: string | null) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.pocamarketSyncItem.findFirst({
      where: {
        OR: [
          { status: "QUEUED" },
          { status: "RUNNING", deviceSerial },
        ],
        batch: { status: { in: ["QUEUED", "RUNNING"] } },
      },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
      include: { batch: { select: { id: true, startedAt: true } } },
    });
    if (!item) return null;

    await tx.pocamarketSyncBatch.update({
      where: { id: item.batchId },
      data: {
        status: "RUNNING",
        deviceSerial,
        startedAt: item.batch.startedAt ? undefined : new Date(),
      },
    });
    return tx.pocamarketSyncItem.update({
      where: { id: item.id },
      data: { status: "RUNNING", deviceSerial },
      select: { id: true, batchId: true, productNumber: true, previousPrice: true },
    });
  });
}

export async function resumePocamarketSyncBatch(
  userId: string,
  batchId: string,
  errorCode?: string,
) {
  const batch = await prisma.pocamarketSyncBatch.findFirst({
    where: {
      id: batchId,
      userId,
      status: { in: ["FAILED", "PAUSED", "READY", "APPLIED"] },
    },
    include: { items: { select: { id: true, status: true, errorCode: true } } },
  });
  if (!batch) throw new Error("이어갈 수 있는 중단 작업이 아닙니다.");
  const retryStatuses = batch.status === "PAUSED"
    ? ["QUEUED", "RUNNING"]
    : ["READY", "APPLIED"].includes(batch.status)
      ? ["FAILED"]
      : ["QUEUED", "RUNNING", "FAILED", "ANOMALY"];
  const retryIds = batch.items
    .filter(
      (item) =>
        retryStatuses.includes(item.status) &&
        (!errorCode || item.errorCode === errorCode),
    )
    .map((item) => item.id);
  if (!retryIds.length) throw new Error("다시 최신화할 미완료 상품이 없습니다.");

  await prisma.$transaction([
    prisma.pocamarketSyncItem.updateMany({
      where: { id: { in: retryIds } },
      data: {
        status: "QUEUED",
        availability: null,
        observedPrice: null,
        observedAvailableCount: null,
        observedAt: null,
        errorMessage: null,
        errorCode: null,
        responseAdapter: null,
        deviceSerial: null,
      },
    }),
    prisma.pocamarketSyncBatch.update({
      where: { id: batchId },
      data: {
        status: "QUEUED",
        errorMessage: null,
        deviceSerial: null,
        completedAt: null,
        startedAt: null,
        scannedCount: batch.items.length - retryIds.length,
      },
    }),
  ]);
  return { resumedCount: retryIds.length };
}

export async function pausePocamarketSyncBatch(userId: string, batchId: string) {
  const result = await prisma.pocamarketSyncBatch.updateMany({
    where: {
      id: batchId,
      userId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "PAUSED",
      deviceSerial: null,
    },
  });
  if (result.count !== 1) {
    throw new Error("일시정지할 수 있는 진행 중 작업이 아닙니다.");
  }
  return { paused: true };
}

export async function stopPocamarketSyncBatch(userId: string, batchId: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.pocamarketSyncBatch.findFirst({
      where: {
        id: batchId,
        userId,
        status: { in: ["QUEUED", "RUNNING", "PAUSED"] },
      },
      select: { id: true },
    });
    if (!batch) {
      throw new Error("정지할 수 있는 진행 중 작업이 아닙니다.");
    }

    const stoppedItems = await tx.pocamarketSyncItem.updateMany({
      where: {
        batchId,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "CANCELLED",
        deviceSerial: null,
        errorCode: "USER_STOPPED",
        errorMessage: "관리자가 최신화 작업을 정지했습니다.",
      },
    });
    await tx.pocamarketSyncBatch.update({
      where: { id: batchId },
      data: {
        status: "CANCELLED",
        deviceSerial: null,
        completedAt: new Date(),
        errorMessage: null,
      },
    });

    return { stopped: true, stoppedCount: stoppedItems.count };
  });
}

type Observation = {
  availability?: "AVAILABLE" | "SOLD_OUT";
  observedPrice?: number;
  observedAvailableCount?: number;
  errorMessage?: string;
  safetyStop?: boolean;
  errorCode?: string;
  responseAdapter?: string;
};

function pocamarketErrorCode(error: unknown) {
  if (error instanceof PocamarketBlockingError) {
    return error.status === 429
      ? "RATE_LIMIT_429"
      : `BLOCKED_${error.status}`;
  }
  if (error instanceof PocamarketSchemaError) return "API_SCHEMA_CHANGED";
  const message = error instanceof Error ? error.message : "";
  if (/HTTP 5\d\d/.test(message)) return "HTTP_5XX";
  if (/timeout|fetch|network|socket/i.test(message)) return "NETWORK";
  if (/ID|상품번호/.test(message)) return "INVALID_PRODUCT_ID";
  return "UNKNOWN";
}

export async function recordPocamarketObservation(
  itemId: string,
  deviceSerial: string | null,
  observation: Observation,
) {
  const item = await prisma.pocamarketSyncItem.findFirst({
    where: {
      id: itemId,
      status: { in: ["QUEUED", "RUNNING"] },
      ...(deviceSerial?.startsWith("WORKER:") ? { deviceSerial } : {}),
    },
    include: { batch: true },
  });
  if (!item || !["QUEUED", "RUNNING"].includes(item.status)) {
    throw new Error("처리할 수 있는 최신화 품목이 아닙니다.");
  }

  let status = "FAILED";
  let observedPrice: number | null = null;
  const availability: string | null = observation.availability ?? null;
  const observedAvailableCount =
    Number.isInteger(observation.observedAvailableCount) &&
    Number(observation.observedAvailableCount) >= 0
      ? Number(observation.observedAvailableCount)
      : null;
  let errorMessage = observation.errorMessage?.slice(0, 1000) ?? null;

  if (observation.availability === "SOLD_OUT") {
    status = "SOLD_OUT";
  } else if (
    observation.availability === "AVAILABLE" &&
    Number.isFinite(observation.observedPrice) &&
    Number(observation.observedPrice) > 0
  ) {
    observedPrice = Number(observation.observedPrice);
    const previous = item.previousPrice ? Number(item.previousPrice) : null;
    status = previous === observedPrice ? "UNCHANGED" : "CHANGED";
  } else if (!errorMessage) {
    errorMessage = "판매 가능 여부 또는 가격을 확인하지 못했습니다.";
  }

  const observedAt = new Date();
  const safeToApply = ["CHANGED", "UNCHANGED", "SOLD_OUT"].includes(status);
  const [updated, , progress] = await prisma.$transaction([
    prisma.pocamarketSyncItem.update({
      where: {
        id: itemId,
        status: { in: ["QUEUED", "RUNNING"] },
        ...(deviceSerial?.startsWith("WORKER:") ? { deviceSerial } : {}),
      },
      data: {
        status,
        availability,
        observedPrice,
        observedAvailableCount,
        errorMessage,
        errorCode:
          status === "FAILED" ? observation.errorCode ?? "UNKNOWN" : null,
        retryCount: status === "FAILED" ? { increment: 1 } : undefined,
        responseAdapter: observation.responseAdapter,
        observedAt,
        deviceSerial,
        appliedById: safeToApply ? item.batch.userId : undefined,
        appliedAt: safeToApply ? observedAt : undefined,
      },
    }),
    prisma.product.update({
      where: { id: item.productId },
      data: safeToApply
        ? {
            salePrice: status === "SOLD_OUT" ? null : observedPrice,
            isSoldOut: status === "SOLD_OUT",
            pocamarketAvailableCount:
              status === "SOLD_OUT" ? 0 : observedAvailableCount,
            pocamarketSyncedAt: observedAt,
            pocamarketLastAttemptAt: observedAt,
          }
        : { pocamarketLastAttemptAt: observedAt },
    }),
    prisma.pocamarketSyncBatch.update({
      where: { id: item.batchId },
      data: {
        scannedCount: { increment: 1 },
      },
      select: { scannedCount: true, totalCount: true },
    }),
  ]);
  if (observation.safetyStop) {
    await prisma.pocamarketSyncBatch.update({
      where: { id: item.batchId },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: new Date(),
      },
    });
  } else if (progress.scannedCount >= progress.totalCount) {
    await prisma.pocamarketSyncBatch.updateMany({
      where: {
        id: item.batchId,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "READY",
        completedAt: new Date(),
      },
    });
  }
  if (safeToApply) {
    await reconcileAiImageJobsForSupply([item.productId]);
  }
  return updated;
}

export async function applyPocamarketSyncBatch(
  userId: string,
  batchId: string,
  itemIds?: string[],
) {
  const items = await prisma.pocamarketSyncItem.findMany({
    where: {
      batchId,
      ...(itemIds?.length ? { id: { in: itemIds } } : {}),
      appliedAt: null,
      status: { in: ["CHANGED", "UNCHANGED", "SOLD_OUT"] },
      batch: { userId, status: { in: ["READY", "APPLIED"] } },
    },
  });
  if (!items.length) throw new Error("반영할 안전한 최신화 결과가 없습니다.");

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          salePrice: item.status === "SOLD_OUT" ? null : item.observedPrice,
          isSoldOut: item.status === "SOLD_OUT",
          pocamarketAvailableCount:
            item.status === "SOLD_OUT" ? 0 : item.observedAvailableCount,
          pocamarketSyncedAt: item.observedAt ?? new Date(),
        },
      });
      await tx.pocamarketSyncItem.update({
        where: { id: item.id },
        data: { appliedById: userId, appliedAt: new Date() },
      });
    }
    await tx.pocamarketSyncBatch.update({
      where: { id: batchId },
      data: { status: "APPLIED" },
    });
  });
  await reconcileAiImageJobsForSupply(items.map((item) => item.productId));
  return { appliedCount: items.length };
}

const apiSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const POCAMARKET_RESULT_SAVE_MAX_ATTEMPTS = 3;

export function pocamarketResultSaveFailureStatus(
  retryCount: number,
  maxAttempts = POCAMARKET_RESULT_SAVE_MAX_ATTEMPTS,
) {
  return retryCount + 1 >= maxAttempts ? "FAILED" : "QUEUED";
}

async function reconcilePocamarketSyncBatch(batchId: string) {
  const [batch, activeCount] = await Promise.all([
    prisma.pocamarketSyncBatch.findUnique({
      where: { id: batchId },
      select: { status: true, totalCount: true },
    }),
    prisma.pocamarketSyncItem.count({
      where: { batchId, status: { in: ["QUEUED", "RUNNING"] } },
    }),
  ]);
  if (!batch) return { status: null, activeCount: 0, queuedCount: 0 };

  const scannedCount = Math.max(0, batch.totalCount - activeCount);
  const canFinish = ["QUEUED", "RUNNING"].includes(batch.status);
  const nextStatus = canFinish && activeCount === 0 ? "READY" : batch.status;
  await prisma.pocamarketSyncBatch.update({
    where: { id: batchId },
    data: {
      scannedCount,
      status: nextStatus,
      completedAt: canFinish && activeCount === 0 ? new Date() : undefined,
    },
  });
  const queuedCount = activeCount
    ? await prisma.pocamarketSyncItem.count({
        where: { batchId, status: "QUEUED" },
      })
    : 0;
  return { status: nextStatus, activeCount, queuedCount };
}

async function recoverObservationSaveFailure(
  batchId: string,
  itemId: string,
  workerMarker: string,
  retryCount: number,
  error: unknown,
) {
  const status = pocamarketResultSaveFailureStatus(retryCount);
  const message =
    error instanceof Error ? error.message : "Unknown persistence error";
  const recovered = await prisma.pocamarketSyncItem.updateMany({
    where: {
      id: itemId,
      batchId,
      status: "RUNNING",
      deviceSerial: workerMarker,
    },
    data: {
      status,
      retryCount: { increment: 1 },
      deviceSerial: null,
      errorCode: "RESULT_SAVE_FAILED",
      errorMessage: message.slice(0, 1000),
    },
  });
  console.error(JSON.stringify({
    event: "pocamarket.sync.result_save_failed",
    batchId,
    itemId,
    retryCount: retryCount + 1,
    terminal: status === "FAILED",
    recovered: recovered.count === 1,
    message: message.slice(0, 300),
  }));
  return recovered.count === 1;
}

// 한 번의 호출에서 처리할 항목 수. 항목마다 포카마켓 배려용 대기(최대 3초)가
// 있고 서버리스 함수는 그 대기 시간에도 메모리 요금이 매겨지므로, 호출 횟수를
// 줄여 호출마다 붙는 고정비용(콜드 스타트, 연결, 배치 조회)을 줄인다.
// 12개 × 최대 3초 = 36초로 maxDuration 60초 안에 여유를 남긴다.
const SYNC_CHUNK_SIZE = 12;

export async function processPocamarketSyncBatch(
  batchId: string,
  limit = SYNC_CHUNK_SIZE,
) {
  const workerToken = randomUUID();
  const now = new Date();
  const workerMarker = `WORKER:${workerToken}`;
  const acquired = await prisma.pocamarketSyncBatch.updateMany({
    where: {
      id: batchId,
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [
        { deviceSerial: null },
        { deviceSerial: "SERVER_API" },
        { updatedAt: { lt: new Date(now.getTime() - 45_000) } },
      ],
    },
    data: { deviceSerial: workerMarker },
  });
  if (acquired.count !== 1) {
    return { processed: 0, stopped: false, status: "RUNNING", alreadyRunning: true };
  }

  // A serverless invocation can be terminated between claiming and recording an
  // item. Recover those stale claims when a new worker obtains the expired lease.
  await prisma.pocamarketSyncItem.updateMany({
    where: {
      batchId,
      status: "RUNNING",
      updatedAt: { lt: new Date(now.getTime() - 45_000) },
    },
    data: {
      status: "QUEUED",
      deviceSerial: null,
      errorCode: "WORKER_TIMEOUT",
      errorMessage: "이전 작업이 중단되어 자동으로 다시 대기열에 넣었습니다.",
    },
  });

  const config = loadPocamarketApiConfig();
  const batchOwner = await prisma.pocamarketSyncBatch.findUnique({
    where: { id: batchId },
    select: {
      userId: true,
      startedAt: true,
      user: { select: { pocamarketSyncSettings: { select: { speedProfile: true } } } },
    },
  });
  const profileName = batchOwner?.user.pocamarketSyncSettings?.speedProfile;
  if (profileName && profileName in pocamarketSpeedProfiles) {
    const profile =
      pocamarketSpeedProfiles[profileName as keyof typeof pocamarketSpeedProfiles];
    config.minDelayMs = profile.minDelayMs;
    config.maxDelayMs = profile.maxDelayMs;
  }
  let processed = 0;
  let stopped = false;
  let adaptivePenaltyMs = 0;
  const automaticSpeed = profileName === "AUTO";
  const requests: Promise<{ itemId: string; observation: Observation }>[] = [];

  try {
  const candidates = await prisma.pocamarketSyncItem.findMany({
    where: {
      batchId,
      status: "QUEUED",
      batch: { status: { in: ["QUEUED", "RUNNING"] } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, productNumber: true, retryCount: true },
  });
  if (candidates.length) {
    const candidateIds = candidates.map((candidate) => candidate.id);
    await prisma.pocamarketSyncItem.updateMany({
      where: { id: { in: candidateIds }, status: "QUEUED" },
      data: { status: "RUNNING", deviceSerial: workerMarker },
    });
    const running = await prisma.pocamarketSyncBatch.updateMany({
      where: {
        id: batchId,
        deviceSerial: workerMarker,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "RUNNING",
        deviceSerial: workerMarker,
        startedAt: batchOwner?.startedAt ? undefined : new Date(),
      },
    });
    if (running.count !== 1) {
      await prisma.pocamarketSyncItem.updateMany({
        where: { id: { in: candidateIds }, status: "RUNNING" },
        data: { status: "QUEUED", deviceSerial: null },
      });
      candidates.splice(0);
    }
  }

  for (const candidate of candidates) {
    if (stopped) break;
    const item = candidate;

    await apiSleep(
      randomDelayMs(
        config.minDelayMs + adaptivePenaltyMs,
        config.maxDelayMs + adaptivePenaltyMs,
      ),
    );

    if (stopped) {
      await prisma.pocamarketSyncItem.updateMany({
        where: { id: item.id, status: "RUNNING", deviceSerial: workerMarker },
        data: { status: "QUEUED", deviceSerial: null },
      });
      break;
    }

    requests.push((async () => {
      const requestStartedAt = Date.now();
      let observation: Observation;
      try {
        const state = await fetchPocamarketProductState(item.productNumber, config);
        const latencyMs = Date.now() - requestStartedAt;
        if (automaticSpeed) {
          adaptivePenaltyMs =
            latencyMs > 2500
              ? Math.min(1000, adaptivePenaltyMs + 250)
              : Math.max(0, adaptivePenaltyMs - 250);
        }
        observation = {
          availability: state.isSoldOut ? "SOLD_OUT" : "AVAILABLE",
          observedPrice: state.isSoldOut ? undefined : state.price,
          observedAvailableCount: state.availableCount ?? undefined,
          responseAdapter: state.adapter,
        };
      } catch (error) {
        const safetyStop = error instanceof PocamarketBlockingError;
        if (safetyStop) stopped = true;
        if (automaticSpeed && !safetyStop) {
          adaptivePenaltyMs = Math.max(0, adaptivePenaltyMs - 250);
        }
        observation = {
          errorCode: pocamarketErrorCode(error),
          errorMessage: error instanceof Error ? error.message : "포카마켓 조회 실패",
          safetyStop,
        };
      }
      return { itemId: item.id, observation };
    })());
  }
  const results = await Promise.allSettled(requests);
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    try {
      await recordPocamarketObservation(
        result.value.itemId,
        workerMarker,
        result.value.observation,
      );
      processed += 1;
    } catch (error) {
      const candidate = candidates.find(
        (item) => item.id === result.value.itemId,
      );
      if (candidate) {
        await recoverObservationSaveFailure(
          batchId,
          candidate.id,
          workerMarker,
          candidate.retryCount,
          error,
        );
      }
    }
  }

  let progress = await reconcilePocamarketSyncBatch(batchId);
  const batch = progress.status === "READY"
    ? await prisma.pocamarketSyncBatch.findUnique({
        where: { id: batchId },
        select: { userId: true },
      })
    : null;
  if (batch) {
    try {
      await applyPocamarketSyncBatch(batch.userId, batchId);
    } catch {
      const appliedCount = await prisma.pocamarketSyncItem.count({
        where: { batchId, appliedAt: { not: null } },
      });
      if (appliedCount > 0) {
        await prisma.pocamarketSyncBatch.update({
          where: { id: batchId },
          data: { status: "APPLIED" },
        });
      }
      // A batch containing only failures/anomalies remains READY for inspection.
    }
    progress = await reconcilePocamarketSyncBatch(batchId);
  }

  const currentBatch = await prisma.pocamarketSyncBatch.findUnique({
    where: { id: batchId },
    select: { status: true },
  });
  return {
    processed,
    stopped,
    status: currentBatch?.status ?? progress.status,
    shouldContinue:
      !stopped &&
      ["QUEUED", "RUNNING"].includes(currentBatch?.status ?? "") &&
      progress.queuedCount > 0,
  };
  } finally {
    await prisma.pocamarketSyncBatch.updateMany({
      where: { id: batchId, deviceSerial: workerMarker },
      data: { deviceSerial: "SERVER_API" },
    });
  }
}
