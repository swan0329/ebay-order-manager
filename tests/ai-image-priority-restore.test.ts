import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/r2", () => ({ uploadBufferToR2: vi.fn() }));
vi.mock("@/lib/dewatermark-api", () => ({
  getDewatermarkCreditBalance: vi.fn(),
  removeWatermarkWithDewatermark: vi.fn(),
}));

import {
  listUpcomingAiImageWork,
  nextQueuedJobSql,
  prioritizeAiImageWork,
  restoreAiPreviewForJob,
  runningAiImageApiBatch,
} from "@/lib/ai-image-work";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockResolvedValue([0, 0]);
});

describe("AI 결과로 되돌리기", () => {
  it("보관해 둔 AI 결과를 검수 이미지로 돌려놓고 보관본을 비운다", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ sku: "505133", backupUrl: "https://r2.test/ai.jpg" }]);
    expect(await restoreAiPreviewForJob("job-1")).toEqual({
      url: "https://r2.test/ai.jpg",
      sku: "505133",
    });
    const sql = mocks.executeRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain(`"backup_preview_url"=NULL`);
    expect(sql).toContain(`"status"<>'approved'`);
  });

  it("보관본이 없으면 되돌리지 않는다", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ sku: "505133", backupUrl: null }]);
    await expect(restoreAiPreviewForJob("job-1")).rejects.toThrow("되돌릴 AI 결과가 없습니다");
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});

describe("먼저 처리", () => {
  it("고른 상품의 우선순위를 올리고 제외 상태면 대기열로 되돌린다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ productId: "p1" }, { productId: "p2" }]);
    const result = await prioritizeAiImageWork(["p1", "p2"]);
    expect(result).toMatchObject({ prioritized: 2 });
    const sql = mocks.queryRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain(`"priority"=1`);
    expect(sql).toContain(`'excluded' THEN 'queued'`);
    // 공급이 없으면 기존 규칙대로 대기 상태로 내린다.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("대상이 없으면 데이터베이스를 건드리지 않는다", async () => {
    expect(await prioritizeAiImageWork([])).toMatchObject({ prioritized: 0 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});

describe("처리 순서", () => {
  it("대기 작업은 우선순위 → 담은 시각 → 상품번호 순서로 고른다", () => {
    expect(nextQueuedJobSql.sql).toContain('ORDER BY j."priority" DESC,j."created_at",p."sku"');
  });

  it("처리 예정 목록도 같은 순서를 쓴다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await listUpcomingAiImageWork({ limit: 10, offset: 0 });
    const sql = mocks.queryRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain('ORDER BY "priority" DESC,"tier","queuedAt" NULLS LAST,"sku"');
  });
});

describe("지금 처리", () => {
  it("돌고 있는 작업이 있으면 알려 주고 새 작업을 만들지 않는다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "batch-1" }]);
    expect(await runningAiImageApiBatch()).toBe("batch-1");
  });

  it("돌고 있는 작업이 없으면 없다고 답한다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await runningAiImageApiBatch()).toBeNull();
  });
});
