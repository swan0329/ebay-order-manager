import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const planMock = vi.hoisted(() => vi.fn());
const createFeedMock = vi.hoisted(() => vi.fn());
const uploadFeedMock = vi.hoisted(() => vi.fn());
const feedStatusMock = vi.hoisted(() => vi.fn());
const downloadFeedMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  productListing: { upsert: vi.fn() },
  productUploadJob: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/services/ebayInventoryPush", () => ({ planEbayInventoryPush: planMock }));
vi.mock("@/lib/services/ebayInventoryFeed", () => ({ createEbayInventoryFeedTask: createFeedMock, uploadEbayInventoryFeedFile: uploadFeedMock, getEbayInventoryFeedStatus: feedStatusMock, downloadEbayInventoryFeedResult: downloadFeedMock }));

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

  it("submits all queued rows as one eBay background feed", async () => {
    const queued = { id: "j1", userId: "u1", productId: "p1", sku: "S1", source: "ebay_inventory_change", status: "pending", rawJson: { batchId: "b1", productId: "p1", action: "CHANGE" } };
    prismaMock.productUploadJob.findMany
      .mockResolvedValueOnce([queued])
      .mockResolvedValueOnce([{ ...queued, status: "running", message: "접수", errorSummary: null, action: "CHANGE", rawJson: { ...queued.rawJson, taskId: "task-1" }, createdAt: new Date(), startedAt: new Date(), finishedAt: null }]);
    planMock.mockResolvedValue({ rows: [{ productId: "p1", itemId: "item-1", sku: "S1", price: 9.5, quantity: 8, listingType: "VARIATION_OPTION", actionable: true }], missingPrice: [] });
    createFeedMock.mockResolvedValue("task-1");
    uploadFeedMock.mockResolvedValue(undefined);

    const result = await processEbayInventoryJobs("u1");

    expect(planMock).toHaveBeenCalledWith({ userId: "u1", productIds: ["p1"] });
    expect(createFeedMock).toHaveBeenCalledWith("u1");
    expect(uploadFeedMock).toHaveBeenCalledWith("u1", "task-1", [expect.objectContaining({ correlationId: "p1", itemId: "item-1", sku: "S1", quantity: 8, price: 9.5 })]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ submitted: 1, succeeded: 0, failed: 0, total: 1, stage: "EBAY_PROCESSING" });
  });

  it("resumes an already-created task instead of creating a duplicate task", async () => {
    const target = { correlationId: "p1", productId: "p1", itemId: "item-1", sku: null, skuLabel: "S1", listingType: "SINGLE", quantity: 10, price: 8.5 };
    const running = { id: "j1", userId: "u1", productId: "p1", sku: "S1", source: "ebay_inventory_change", action: "CHANGE", status: "running", message: "업로드 중", errorSummary: null, rawJson: { batchId: "b1", productId: "p1", action: "CHANGE", taskId: "task-1", target }, createdAt: new Date(), startedAt: new Date(), finishedAt: null };
    prismaMock.productUploadJob.findMany
      .mockResolvedValueOnce([running])
      .mockResolvedValueOnce([running]);
    feedStatusMock.mockResolvedValue({ status: "CREATED", successCount: 0, failureCount: 0 });
    uploadFeedMock.mockResolvedValue(undefined);

    await processEbayInventoryJobs("u1");

    expect(createFeedMock).not.toHaveBeenCalled();
    expect(uploadFeedMock).toHaveBeenCalledWith("u1", "task-1", [target]);
  });

  it("persists success only after the eBay result file reports success", async () => {
    const target = { correlationId: "p1", productId: "p1", itemId: "item-1", sku: null, skuLabel: "S1", listingType: "SINGLE", quantity: 10, price: 8.5 };
    const running = { id: "j1", userId: "u1", productId: "p1", sku: "S1", source: "ebay_inventory_change", action: "CHANGE", status: "running", message: "처리 중", errorSummary: null, rawJson: { batchId: "b1", productId: "p1", action: "CHANGE", taskId: "task-1", target }, createdAt: new Date(), startedAt: new Date(), finishedAt: null };
    prismaMock.productUploadJob.findMany
      .mockResolvedValueOnce([running])
      .mockResolvedValueOnce([{ ...running, status: "success", message: "완료", finishedAt: new Date() }]);
    feedStatusMock.mockResolvedValue({ status: "COMPLETED", successCount: 1, failureCount: 0 });
    downloadFeedMock.mockResolvedValue([{ correlationId: "p1", success: true, message: "SUCCESS" }]);

    const result = await processEbayInventoryJobs("u1");

    expect(prismaMock.productListing.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ externalId: "item-1", quantity: 10, price: 8.5 }) }));
    expect(result).toMatchObject({ active: 0, succeeded: 1, failed: 0, total: 1 });
  });

  it("does not download and persist the same completed result concurrently", async () => {
    const target = { correlationId: "p1", productId: "p1", itemId: "item-1", sku: null, skuLabel: "S1", listingType: "SINGLE", quantity: 10, price: 8.5 };
    const running = { id: "j1", userId: "u1", productId: "p1", sku: "S1", source: "ebay_inventory_change", action: "CHANGE", status: "running", message: "eBay 결과 파일 확인 완료 · 내부 반영 저장 중", errorSummary: null, rawJson: { batchId: "b1", productId: "p1", action: "CHANGE", taskId: "task-1", target }, createdAt: new Date(), updatedAt: new Date(), startedAt: new Date(), finishedAt: null };
    prismaMock.productUploadJob.findMany
      .mockResolvedValueOnce([running])
      .mockResolvedValueOnce([running]);
    prismaMock.productUploadJob.updateMany.mockResolvedValueOnce({ count: 0 });
    feedStatusMock.mockResolvedValue({ status: "COMPLETED", successCount: 1, failureCount: 0 });

    await processEbayInventoryJobs("u1");

    expect(downloadFeedMock).not.toHaveBeenCalled();
    expect(prismaMock.productListing.upsert).not.toHaveBeenCalled();
  });

  it("allows only one status poller to own a submitted task lease", async () => {
    const target = { correlationId: "p1", productId: "p1", itemId: "item-1", sku: null, skuLabel: "S1", listingType: "SINGLE", quantity: 1, price: 8.5 };
    const running = { id: "j1", userId: "u1", productId: "p1", sku: "S1", source: "ebay_inventory_change", action: "CHANGE", status: "running", message: "eBay 작업 상태 확인 중", errorSummary: null, rawJson: { batchId: "b1", productId: "p1", action: "CHANGE", taskId: "task-1", target }, createdAt: new Date(), updatedAt: new Date(), startedAt: new Date(), finishedAt: null };
    prismaMock.productUploadJob.findMany.mockResolvedValueOnce([running]).mockResolvedValueOnce([running]);
    prismaMock.productUploadJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await processEbayInventoryJobs("u1");

    expect(feedStatusMock).not.toHaveBeenCalled();
    expect(downloadFeedMock).not.toHaveBeenCalled();
    expect(uploadFeedMock).not.toHaveBeenCalled();
  });
});
