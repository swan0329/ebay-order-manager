import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), diagnose: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiUser: mocks.user, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/lib/ebay-feed-operations", () => ({ listEbayFeedJobs: mocks.list, diagnoseEbayFeedJob: mocks.diagnose, refreshEbayFeedJob: mocks.refresh, submitEbayFeedOperation: vi.fn() }));
import { GET } from "@/app/api/ebay/operations/route";
import { UnauthorizedError } from "@/lib/session";

beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "admin" }); });
it("인증된 관리자의 작업 이력만 조회한다", async () => {
  mocks.list.mockResolvedValue([]);
  expect((await GET(new Request("https://example.com/api/ebay/operations?history=true"))).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("admin", undefined);
});
it("원문 진단은 관리자 범위로 읽고 결과를 변경하지 않는다", async () => {
  mocks.diagnose.mockResolvedValue({ failures: [] });
  expect((await GET(new Request("https://example.com/api/ebay/operations?jobId=job&diagnose=true"))).status).toBe(200);
  expect(mocks.diagnose).toHaveBeenCalledWith("admin", "job");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("미인증 또는 작업자 요청을 조회 전에 차단한다", async () => {
  mocks.user.mockRejectedValue(new UnauthorizedError());
  for (const query of ["history=true", "jobId=job&diagnose=true"]) {
    expect((await GET(new Request(`https://example.com/api/ebay/operations?${query}`))).status).toBe(401);
  }
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.diagnose).not.toHaveBeenCalled();
});
