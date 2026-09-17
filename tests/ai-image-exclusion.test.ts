import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $executeRawUnsafe: mocks.executeRawUnsafe,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/r2", () => ({ uploadBufferToR2: vi.fn() }));
vi.mock("@/lib/dewatermark-api", () => ({
  getDewatermarkCreditBalance: vi.fn(),
  removeWatermarkWithDewatermark: vi.fn(),
}));

import {
  createAiJobs,
  excludeAiImageWork,
  listExcludedAiImageWork,
  listUpcomingAiImageWork,
  restoreExcludedAiImageWork,
} from "@/lib/ai-image-work";

function lastSql() {
  const call = mocks.queryRaw.mock.calls.at(-1);
  return (call?.[0] as string[]).join(" ");
}

beforeEach(() => {
  mocks.queryRaw.mockReset();
  mocks.executeRaw.mockReset();
  mocks.executeRawUnsafe.mockReset();
  mocks.transaction.mockReset();
  mocks.executeRaw.mockResolvedValue(0);
  mocks.executeRawUnsafe.mockResolvedValue(0);
  mocks.transaction.mockResolvedValue([0, 0]);
});

describe("AI 이미지 처리 예정 미리보기", () => {
  it("대기열 작업을 먼저, 아직 대기열에 없는 상품을 그다음 순서로 돌려준다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        jobId: "job-1",
        productId: "p-1",
        sku: "10001",
        productName: "카드 A",
        sourceUrl: "https://pocamarket/a.jpg",
        stockQuantity: 1,
        supplyCount: 0,
        queued: true,
        totalCount: 7,
      },
      {
        jobId: null,
        productId: "p-2",
        sku: "10002",
        productName: "카드 B",
        sourceUrl: "https://pocamarket/b.jpg",
        stockQuantity: 0,
        supplyCount: 3,
        queued: false,
        totalCount: 7,
      },
    ]);
    const result = await listUpcomingAiImageWork({ limit: 48, offset: 0 });
    expect(result.total).toBe(7);
    expect(result.items).toHaveLength(2);
    // 창 함수로 센 전체 개수는 화면 항목에 섞이지 않는다.
    expect(result.items[0]).not.toHaveProperty("totalCount");
    expect(result.items.map((item) => item.queued)).toEqual([true, false]);
    const sql = lastSql();
    expect(sql).toContain(`j."status"='queued'`);
    expect(sql).toContain('ORDER BY "priority" DESC,"tier","queuedAt" NULLS LAST,"sku"');
    // 이미 처리했거나 사람이 검수 중인 작업은 예정 목록에 넣지 않는다.
    expect(sql).not.toContain("'review'");
    expect(sql).not.toContain("'approved'");
  });

  it("제외 목록은 제외 상태만 조회하고 시각을 문자열로 돌려준다", async () => {
    const excludedAt = new Date("2026-09-15T01:02:03.000Z");
    mocks.queryRaw.mockResolvedValueOnce([
      {
        jobId: "job-9",
        productId: "p-9",
        sku: "10009",
        productName: "카드 C",
        sourceUrl: "https://pocamarket/c.jpg",
        stockQuantity: 2,
        supplyCount: 0,
        queued: false,
        excludedAt,
        totalCount: 1,
      },
    ]);
    const result = await listExcludedAiImageWork({ limit: 48, offset: 0 });
    expect(result).toMatchObject({ total: 1 });
    expect(result.items[0].excludedAt).toBe(excludedAt.toISOString());
    expect(lastSql()).toContain(`j."status"=`);
  });
});

describe("AI 이미지 작업 제외", () => {
  it("처리 중·승인 완료 작업은 건드리지 않고 되돌릴 수 있는 상태만 제외한다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ productId: "p-1" }]);
    const result = await excludeAiImageWork(["p-1", "p-2"], "admin-1");
    expect(result).toMatchObject({
      excluded: 1,
      skipped: 1,
      productIds: ["p-1"],
    });
    const sql = lastSql();
    expect(sql).toContain('ON CONFLICT ("product_id") DO UPDATE');
    expect(sql).toContain('WHERE "ai_image_jobs"."status" IN');
    expect(sql).not.toContain("DELETE");
    // 상태 목록은 문자열이 아니라 바인딩 값으로 전달된다.
    const values = JSON.stringify(mocks.queryRaw.mock.calls.at(-1)?.slice(1));
    expect(values).toContain('"queued"');
    expect(values).toContain('"waiting_supply"');
    expect(values).toContain('"rework"');
    expect(values).toContain('"failed"');
    expect(values).not.toContain('"processing"');
    expect(values).not.toContain('"approved"');
    expect(values).not.toContain('"review"');
  });

  it("대상이 없으면 데이터베이스를 호출하지 않는다", async () => {
    expect(await excludeAiImageWork([], "admin-1")).toMatchObject({
      excluded: 0,
    });
    expect(await restoreExcludedAiImageWork([])).toMatchObject({ restored: 0 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("제외를 해제하면 대기열로 돌리고 공급 상태를 다시 맞춘다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ productId: "p-1" }]);
    const result = await restoreExcludedAiImageWork(["p-1"]);
    expect(result).toMatchObject({ restored: 1, productIds: ["p-1"] });
    const sql = mocks.queryRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain(`SET "status"='queued'`);
    expect(sql).toContain(`WHERE "status"=`);
    // 공급이 없는 상품이 곧바로 처리되지 않도록 기존 규칙을 다시 적용한다.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("대기열 추가는 제외한 상품의 작업 행 때문에 다시 담기지 않는다", async () => {
    await createAiJobs(100);
    const sql = mocks.executeRaw.mock.calls.at(-1)?.[0].join(" ") ?? "";
    expect(sql).toContain('LEFT JOIN "ai_image_jobs" j ON j."product_id"=p."id"');
    expect(sql).toContain('WHERE j."id" IS NULL');
    expect(sql).toContain('ORDER BY p."sku"');
  });
});
