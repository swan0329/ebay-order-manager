import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(),
  update: vi.fn(), updateMany: vi.fn(), productUpdate: vi.fn(), transaction: vi.fn(),
  request: vi.fn(), rawRequest: vi.fn(), report: vi.fn(),
  reportFind: vi.fn(), listingFind: vi.fn(), tasks: vi.fn(), sync: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  ebayFeedJob: { findFirst: mocks.findFirst, findUniqueOrThrow: mocks.findUniqueOrThrow,
    findMany: mocks.findMany, update: mocks.update, updateMany: mocks.updateMany },
  product: { updateMany: mocks.productUpdate }, $transaction: mocks.transaction,
  ebayReportImport: { findFirst: mocks.reportFind }, ebayActiveListing: { findMany: mocks.listingFind },
} }));
vi.mock("@/lib/services/ebayApiService", () => ({
  getActiveEbayInventoryAccount: vi.fn().mockResolvedValue({}),
  ebayApiRequest: mocks.request, ebayApiRawRequest: mocks.rawRequest,
}));
vi.mock("@/lib/ebay-active-report-task", () => ({ requestEbayActiveReport: mocks.report, listEbayInventoryTasks: mocks.tasks }));
vi.mock("@/lib/ebay-active-report-sync", () => ({ syncEbayActiveReport: mocks.sync }));
vi.mock("@/lib/product-operations", () => ({ getOperationalProductIds: vi.fn() }));
vi.mock("@/lib/listing-price", () => ({ resolveListingPriceUsd: vi.fn() }));
vi.mock("@/lib/variation-listing-products", () => ({ getEbayVariationMembershipByProductId: vi.fn() }));

import { recoverIncompleteEbayFeedJobs, refreshEbayFeedJob, verifyEbayFeedJob } from "@/lib/ebay-feed-operations";

const missing = "eBay 결과에서 처리 상태를 확인하지 못했습니다.";
const targets = [
  { productId: "p1", sku: "182221", productName: "A", itemId: "shared" },
  { productId: "p2", sku: "182222", productName: "B", itemId: "shared" },
];
function job() {
  return { id: "job", userId: "user", ebayTaskId: "task", status: "COMPLETED_WITH_ERROR",
    totalCount: 2, successCount: 1, failureCount: 1, completedAt: new Date(), error: null,
    targetsJson: targets, failuresJson: [{ ...targets[1], message: missing }] };
}

describe("eBay Feed 결과 복구", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(job());
    mocks.findUniqueOrThrow.mockResolvedValue(job());
    mocks.findMany.mockResolvedValue([job()]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.request.mockResolvedValue({ body: { status: "COMPLETED_WITH_ERROR", uploadSummary: { successCount: 1, failureCount: 1 } } });
    mocks.rawRequest.mockResolvedValue({ body: Buffer.from(`
      <ReviseInventoryStatusResponse><CorrelationID>p1</CorrelationID><Ack>Success</Ack></ReviseInventoryStatusResponse>
      <ReviseInventoryStatusResponse><CorrelationID>p2</CorrelationID><Ack>Failure</Ack><Errors><LongMessage>Invalid quantity</LongMessage></Errors></ReviseInventoryStatusResponse>
    `) });
  });

  it("일부 결과만 누락된 완료 작업도 외부 변경 없이 다시 읽어 확정한다", async () => {
    expect(await recoverIncompleteEbayFeedJobs("user")).toBe(1);
    expect(mocks.request).toHaveBeenCalledWith({}, { path: "/sell/feed/v1/task/task" });
    expect(mocks.rawRequest).toHaveBeenCalledWith({}, { path: "/sell/feed/v1/task/task/download_result_file", responseType: "buffer" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.rawRequest).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      successCount: 1, failureCount: 1, error: null,
      failuresJson: [expect.objectContaining({ productId: "p2", message: "Invalid quantity" })],
    }) }));
    expect(mocks.productUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["p2"] } }, data: { uploadError: "Invalid quantity", uploadErrorSummary: "Invalid quantity" },
    }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("이전 식별자 없는 실패 원인을 화면용 작업 오류로 보존한다", async () => {
    mocks.rawRequest.mockResolvedValue({ body: Buffer.from(`<ReviseInventoryStatusResponse><Ack>Failure</Ack><Errors><LongMessage>Listing cannot be revised</LongMessage></Errors></ReviseInventoryStatusResponse>`) });
    await refreshEbayFeedJob("user", "job");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      error: "상품별 연결이 불가능한 eBay 오류: Listing cannot be revised", successCount: 0, failureCount: 2,
    }) }));
  });

  it("이미 진단한 식별자 없는 오류는 계속 재조회하지 않는다", async () => {
    const diagnosed = { ...job(), error: "상품별 연결이 불가능한 eBay 오류: Listing cannot be revised" };
    mocks.findMany.mockResolvedValue([diagnosed]);
    mocks.findFirst.mockResolvedValue(diagnosed);
    expect(await recoverIncompleteEbayFeedJobs("user")).toBe(0);
    await refreshEbayFeedJob("user", "job");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.rawRequest).not.toHaveBeenCalled();
  });

  it("단품의 외부 SKU가 달라도 새 eBay 보고서의 ItemID·가격·수량이 맞아야 검증한다", async () => {
    const completedAt = new Date("2026-09-07T12:00:00Z");
    mocks.findFirst.mockResolvedValue({ ...job(), operation: "revise", completedAt, targetsJson: [{ ...targets[0], useSku: false, price: "12.30", quantity: 2 }] });
    mocks.reportFind.mockResolvedValue({ id: "report", fileName: "ebay-feed-active-task-report-task" });
    mocks.listingFind.mockResolvedValue([{ itemId: "shared", sku: "OLD-SKU", price: "12.30", quantity: 2 }]);
    for (const [creationDate, expected] of [["2026-09-07T11:00:00Z", false], ["2026-09-07T12:01:00Z", true]] as const) {
      mocks.tasks.mockResolvedValue({ tasks: [{ taskId: "report-task", creationDate }] });
      const result = await verifyEbayFeedJob("user", "job");
      expect(result.checks[0].verified).toBe(expected);
    }
    mocks.listingFind.mockResolvedValue([{ itemId: "shared", sku: "OLD-SKU", price: "12.30", quantity: 1 }]);
    expect((await verifyEbayFeedJob("user", "job")).checks[0].verified).toBe(false);
  });
});
