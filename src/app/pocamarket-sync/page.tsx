import { PocamarketSyncClient } from "@/components/PocamarketSyncClient";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import {
  getPocamarketSyncSettings,
  getPocamarketSyncSummary,
} from "@/lib/pocamarket-sync";
import { requireUser } from "@/lib/session";

export default async function PocamarketSyncPage() {
  const user = await requireUser();
  const [batches, settings] = await Promise.all([prisma.pocamarketSyncBatch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { items: { orderBy: { productNumber: "asc" }, include: { product: { select: { productName: true } } } } },
  }), getPocamarketSyncSettings(user.id)]);
  const summary = await getPocamarketSyncSummary(settings.dailyBatchSize);
  const props = batches.map((batch) => ({
    ...batch, createdAt: batch.createdAt.toISOString(), updatedAt: batch.updatedAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null, completedAt: batch.completedAt?.toISOString() ?? null,
    items: batch.items.map((item) => ({
      ...item, previousPrice: item.previousPrice?.toString() ?? null,
      observedPrice: item.observedPrice?.toString() ?? null,
      createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
      observedAt: item.observedAt?.toISOString() ?? null, appliedAt: item.appliedAt?.toISOString() ?? null,
    })),
  }));
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6"><h1 className="text-2xl font-bold">포카마켓 최신화</h1><p className="mb-6 mt-1 text-sm text-zinc-600">예약 수집과 수동 최신화 진행 상황을 확인합니다.</p><PocamarketSyncClient initialBatches={props} initialSettings={{ enabled: settings.enabled, scheduledHour: settings.scheduledHour, dailyBatchSize: settings.dailyBatchSize, speedProfile: settings.speedProfile, priorityStrategy: settings.priorityStrategy }} initialSummary={summary}/></main></div>;
}
