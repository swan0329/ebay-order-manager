import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: query } }));

import { getProductStats } from "@/lib/product-stats";

beforeEach(() => query.mockReset());

describe("이미지 작업 필요 건수", () => {
  it("BTS·작업 제외·통과(업로드 대기) 상품을 빼고 공급이 있는 미작업만 센다", async () => {
    query.mockResolvedValueOnce([{ totalCount: 1, aiImagePendingCount: 1 }]);
    await getProductStats("EBAY");
    const call = query.mock.calls[0];
    const sql = (call[0] as string[]).join(" ");
    const values = JSON.stringify(call.slice(1));
    // 공급: 보유 재고 또는 포카마켓 조달 가능 수량
    expect(sql).toContain('"stock_quantity" > 0');
    expect(sql).toContain('COALESCE("pocamarket_available_count", 0) > 0');
    // BTS 제외
    expect(values).toContain("BTS");
    expect(values).toContain("방탄소년단");
    // 사람이 작업 제외한 상품 제외
    expect(sql).toContain('"aiWorkPending"');
    // 중첩된 SQL 조각은 문자열이 아니라 바인딩 값으로 전달된다.
    expect(values).toContain('ai_image_jobs');
    expect(values).toContain('settled_job');
    expect(values).toContain('"excluded"');
    // 사람이 통과시켜 업로드만 남은 건은 '작업 필요'가 아니다.
    expect(values).toContain('"pass_ready"');
    // 검수 대기와 보류는 사람이 판단해야 하므로 계속 센다.
    expect(values).not.toContain('"review"');
    expect(values).not.toContain('"held"');
  });
});
