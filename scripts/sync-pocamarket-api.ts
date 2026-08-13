import { prisma } from "../src/lib/prisma";
import { pathToFileURL } from "node:url";
import {
  fetchPocamarketProductState,
  loadPocamarketApiConfig,
  PocamarketBlockingError,
  randomDelayMs,
} from "../src/lib/pocamarket-api-collector";

type SyncSummary = {
  total: number;
  updated: number;
  failed: number;
  stopped: boolean;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function syncPocamarketProducts(): Promise<SyncSummary> {
  const config = loadPocamarketApiConfig();
  const products = await prisma.product.findMany({
    where: {
      status: { in: ["active", "ACTIVE"] },
      pocamarketId: { not: null },
    },
    select: { id: true, pocamarketId: true },
    orderBy: { pocamarketId: "asc" },
  });
  const summary: SyncSummary = {
    total: products.length,
    updated: 0,
    failed: 0,
    stopped: false,
  };

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const pocamarketId = product.pocamarketId;
    if (!pocamarketId) continue;

    if (index > 0) {
      await sleep(randomDelayMs(config.minDelayMs, config.maxDelayMs));
    }

    try {
      const state = await fetchPocamarketProductState(pocamarketId, config);
      await prisma.product.update({
        where: { id: product.id },
        data: {
          salePrice: state.isSoldOut ? null : state.price,
          isSoldOut: state.isSoldOut,
          pocamarketAvailableCount: state.availableCount,
          pocamarketSyncedAt: new Date(),
          pocamarketLastAttemptAt: new Date(),
        },
      });
      summary.updated += 1;
      console.info(`[pocamarket-sync] ${pocamarketId}: updated`);
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      console.error(`[pocamarket-sync] ${pocamarketId}: ${message}`);
      if (error instanceof PocamarketBlockingError) {
        summary.stopped = true;
        break;
      }
    }
  }
  return summary;
}

async function main() {
  try {
    const summary = await syncPocamarketProducts();
    console.info(`[pocamarket-sync] summary=${JSON.stringify(summary)}`);
    if (summary.stopped) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
