import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  approve: vi.fn(),
  assertAllowed: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireApiUser: mocks.user,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw },
}));
vi.mock("@/lib/ai-image-policy", () => ({
  aiJobAllowedSql: { sql: "", values: [] },
  assertAiJobAllowed: mocks.assertAllowed,
  excludeManualAiJobs: vi.fn(),
}));
vi.mock("@/lib/ai-image-work", () => ({
  approveAiJob: mocks.approve,
  claimNextAiJob: vi.fn(),
  completeAiJob: vi.fn(),
  completeAiJobWithDewatermark: vi.fn(),
  completeAiJobWithSafeFallback: vi.fn(),
  createAiImageApiBatch: vi.fn(),
  createAiJobs: vi.fn(),
  excludeAiImageWork: vi.fn(),
  listExcludedAiImageWork: vi.fn(),
  listUpcomingAiImageWork: vi.fn(),
  nextQueuedJobSql: { sql: "", values: [] },
  repairAiPreviewCorners: vi.fn(),
  restoreExcludedAiImageWork: vi.fn(),
}));
vi.mock("@/lib/dewatermark-api", () => ({ getDewatermarkCreditBalance: vi.fn() }));
vi.mock("@/lib/image-workbench-settings", () => ({ getImageWorkbenchSettings: vi.fn() }));

import { POST } from "@/app/api/ai-image-work/route";

const pass = (id = "job-1") =>
  new Request("https://example.com/api/ai-image-work", {
    method: "POST",
    body: JSON.stringify({ action: "pass", id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  mocks.assertAllowed.mockResolvedValue(undefined);
  mocks.executeRaw.mockResolvedValue(1);
});

describe("검수 통과", () => {
  it("통과하면 상품 이미지 업로드까지 바로 끝낸다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    mocks.approve.mockResolvedValue("https://r2.test/products/505133/505133.jpg");
    const response = await POST(pass());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      uploaded: true,
      url: "https://r2.test/products/505133/505133.jpg",
    });
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith("job-1", "admin-1");
  });

  it("업로드가 실패해도 통과 판정은 남기고 다시 올릴 수 있게 알린다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    mocks.approve.mockRejectedValue(new Error("R2 업로드 실패"));
    const response = await POST(pass());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, uploaded: false });
    expect(body.uploadError).toContain("R2 업로드 실패");
    // 실패를 미통과로 되돌리지 않는다.
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("검수 대기 상태가 아니면 업로드하지 않는다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await (await POST(pass())).json()).toMatchObject({ uploaded: false });
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("관리자가 아니면 아무것도 하지 않는다", async () => {
    const { UnauthorizedError } = await import("@/lib/session");
    mocks.user.mockRejectedValue(new UnauthorizedError());
    expect((await POST(pass())).status).toBe(401);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
