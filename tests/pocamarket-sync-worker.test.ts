import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  item: { updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  batch: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  product: { update: vi.fn() },
  transaction: vi.fn(),
  fetch: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  pocamarketSyncItem: mocks.item, pocamarketSyncBatch: mocks.batch,
  product: mocks.product, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/ai-image-work", () => ({ reconcileAiImageJobsForSupply: mocks.reconcile }));
vi.mock("@/lib/pocamarket-api-collector", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pocamarket-api-collector")>(),
  fetchPocamarketProductState: mocks.fetch,
}));
import { processPocamarketSyncBatch } from "@/lib/pocamarket-sync";

describe("serverless Pocamarket worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    mocks.item.updateMany.mockResolvedValue({ count: 1 });
    mocks.batch.updateMany.mockResolvedValue({ count: 1 });
    mocks.batch.findUnique.mockResolvedValue({
      userId: "admin", startedAt: new Date(), status: "RUNNING", totalCount: 10,
      user: { pocamarketSyncSettings: { speedProfile: "FAST" } },
    });
    mocks.item.findMany.mockResolvedValue([
      { id: "a", productNumber: "1", retryCount: 0 },
      { id: "b", productNumber: "2", retryCount: 0 },
    ]);
    mocks.item.findFirst.mockImplementation(async ({ where }) => ({
      id: where.id, productId: where.id, batchId: "batch", previousPrice: 100,
      status: "RUNNING", batch: { userId: "admin" },
    }));
    mocks.item.count.mockResolvedValue(8);
    mocks.item.update.mockResolvedValue({});
    mocks.product.update.mockResolvedValue({});
    mocks.batch.update.mockResolvedValue({ scannedCount: 1, totalCount: 10 });
    mocks.transaction.mockImplementation(async (ops) => Promise.all(ops));
    mocks.fetch.mockResolvedValue({ price: 100, isSoldOut: false, availableCount: 1 });
    mocks.reconcile.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("persists the first result before the next request and never preclaims the whole chunk", async () => {
    const result = processPocamarketSyncBatch("batch", 100);
    await vi.runAllTimersAsync();
    expect((await result).processed).toBe(2);
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[1]);
    expect(mocks.item.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    const claims = mocks.item.updateMany.mock.calls.filter(([arg]) => arg.data.status === "RUNNING");
    expect(claims.map(([arg]) => arg.where.id)).toEqual(["a", "b"]);
    expect(mocks.fetch.mock.calls[0][2].deadlineAt).toBeLessThan(Date.now() + 8001);
  });

  it("leaves unstarted items queued after slow persistence uses the time budget", async () => {
    mocks.reconcile.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 26_000);
    });
    const result = processPocamarketSyncBatch("batch");
    await vi.runAllTimersAsync();
    expect((await result).processed).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.item.updateMany.mock.calls.filter(([arg]) => arg.data.status === "RUNNING")).toHaveLength(1);
  });

  it("bounds stale timeout recovery and does not steal a live 300-second invocation", async () => {
    const result = processPocamarketSyncBatch("batch");
    await vi.runAllTimersAsync(); await result;
    const lease = mocks.batch.updateMany.mock.calls[0][0].where.OR[2].updatedAt.lt;
    expect(lease.toISOString()).toBe("2026-09-06T23:54:00.000Z");
    expect(mocks.item.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "RUNNING", retryCount: { gte: 2 } }),
      data: expect.objectContaining({ status: "FAILED", retryCount: { increment: 1 } }),
    }));
  });

  it("continues past the browser budget for a long cron invocation", async () => {
    mocks.reconcile.mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 26_000); });
    const result = processPocamarketSyncBatch("batch", 100, { startBudgetMs: 240_000 });
    await vi.runAllTimersAsync();
    expect((await result).processed).toBe(2);
    expect(mocks.item.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("releases the lease when configuration/database setup fails", async () => {
    mocks.batch.findUnique.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(processPocamarketSyncBatch("batch")).rejects.toThrow("database unavailable");
    expect(mocks.batch.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { deviceSerial: "SERVER_API" },
    }));
  });
});
