import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ latest: vi.fn(), feed: vi.fn(), tasks: vi.fn(), download: vi.fn(), apply: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ebayReportImport: { findFirst: mocks.latest }, ebayFeedJob: { findFirst: mocks.feed } } }));
vi.mock("@/lib/ebay-active-report", () => ({ importEbayActiveReport: mocks.apply }));
vi.mock("@/lib/services/ebayApiService", () => ({ ebayApiRawRequest: mocks.download }));
vi.mock("@/lib/ebay-active-report-task", () => ({ listEbayInventoryTasks: mocks.tasks, listEbayReportSyncUsers: vi.fn(), requestEbayActiveReport: mocks.request }));
import { syncEbayActiveReport } from "@/lib/ebay-active-report-sync";
const older = { taskId: "older", status: "COMPLETED", creationDate: "2026-09-07T12:05:00Z" };
const newer = { taskId: "newer", status: "COMPLETED", creationDate: "2026-09-07T12:07:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tasks.mockResolvedValue({ account: {}, tasks: [older, newer] });
  mocks.feed.mockResolvedValue({ completedAt: new Date("2026-09-07T12:06:00Z") });
  mocks.download.mockResolvedValue({ body: Buffer.from('<BulkDataExchangeResponses><ActiveInventoryReport><SKUDetails><ItemID>1001</ItemID><SKU>18432</SKU><Price>13.5</Price><Quantity>3</Quantity></SKUDetails></ActiveInventoryReport></BulkDataExchangeResponses>') });
});
it("최신 보고서 적용 후 이전 미수집 보고서를 다시 적용하지 않는다", async () => {
  mocks.latest.mockResolvedValue({ fileName: "ebay-feed-active-task-newer", createdAt: new Date("2026-09-07T12:08:00Z") });
  await syncEbayActiveReport("user");
  await syncEbayActiveReport("user");
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledWith("user", false);
});
it("과거 배포가 오래된 보고서로 되돌린 상태는 최신 결과를 재적용해 복구한다", async () => {
  mocks.latest.mockResolvedValue({ fileName: "ebay-feed-active-task-older", createdAt: new Date("2026-09-07T12:10:00Z") });
  await syncEbayActiveReport("user");
  expect(mocks.download).toHaveBeenCalledWith({}, expect.objectContaining({ path: "/sell/feed/v1/task/newer/download_result_file" }));
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ fileName: "ebay-feed-active-task-newer", rows: [expect.objectContaining({ price: 13.5, quantity: 3 })] }));
});
it("첫 동기화도 응답 배열 순서와 무관하게 최신 보고서를 선택한다", async () => {
  mocks.latest.mockResolvedValue(null);
  await syncEbayActiveReport("user");
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ fileName: "ebay-feed-active-task-newer" }));
});
it("기존 보고서 작업이 조회 범위 밖이면 그보다 오래된 결과를 적용하지 않는다", async () => {
  mocks.latest.mockResolvedValue({ fileName: "ebay-feed-active-task-outside", createdAt: new Date("2026-09-07T13:00:00Z") });
  await syncEbayActiveReport("user");
  expect(mocks.apply).not.toHaveBeenCalled();
});
