import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const pushMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  productUploadJob: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/services/ebayInventoryPush", () => ({ pushEbayInventory: pushMock }));

const { enqueueEbayInventoryJobs, processEbayInventoryJobs } = await import("@/lib/services/ebayInventoryJobs");

describe("eBay inventory background jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.productUploadJob.createMany.mockResolvedValue({ count: 1 });
    prismaMock.productUploadJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.productUploadJob.update.mockResolvedValue({});
    prismaMock.$transaction.mockResolvedValue([]);
  });

  it("persists only products that are not already active", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ id: "p1", sku: "S1" }, { id: "p2", sku: "S2" }]);
    prismaMock.productUploadJob.findMany
      .mockResolvedValueOnce([{ rawJson: { batchId: "old", productId: "p2", action: "CHANGE" } }])
      .mockResolvedValueOnce([]);

    await enqueueEbayInventoryJobs({ userId: "u1", productIds: ["p1", "p2", "p1"], action: "CHANGE" });

    expect(prismaMock.productUploadJob.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ productId: "p1", sku: "S1", source: "ebay_inventory_change", status: "pending" })] });
  });

  it("claims a queued job, uses the latest plan, and records verified success transactionally", async () => {
    const queued = { id: "j1", userId: "u1", productId: "p1", sku: "S1", source: "ebay_inventory_change", status: "pending", rawJson: { batchId: "b1", productId: "p1", action: "CHANGE" } };
    prismaMock.productUploadJob.findMany
      .mockResolvedValueOnce([queued])
      .mockResolvedValueOnce([{ ...queued, status: "success", message: "완료", errorSummary: null, action: "CHANGE", createdAt: new Date(), startedAt: new Date(), finishedAt: new Date() }]);
    pushMock.mockResolvedValue({
      rows: [{ productId: "p1", itemId: "item-1", sku: "S1", price: 9.5, quantity: 8 }],
      succeededKeys: ["item-1:S1"],
      failed: [],
    });

    const result = await processEbayInventoryJobs("u1");

    expect(pushMock).toHaveBeenCalledWith({ userId: "u1", productIds: ["p1"], dryRun: false, limit: 200 });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ succeeded: 1, failed: 0, total: 1 });
  });
});
