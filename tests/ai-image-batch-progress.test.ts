import { describe, expect, it } from "vitest";
import { shouldReloadAiImageWorkList } from "@/lib/ai-image-batch-progress";

const running = { status: "running", completedCount: 3, failedCount: 1 };

describe("서버 배치 진행 중 검수 목록 갱신", () => {
  it("첫 조회는 기억만 하고 다시 그리지 않는다", () => {
    expect(
      shouldReloadAiImageWorkList({
        batch: running, lastProcessed: -1, lastReloadedAt: 0, now: 1_000_000,
      }),
    ).toBe(false);
  });

  it("처리 수가 늘면 목록을 다시 받는다", () => {
    expect(
      shouldReloadAiImageWorkList({
        batch: running, lastProcessed: 2, lastReloadedAt: 0, now: 1_000_000,
      }),
    ).toBe(true);
  });

  it("변화가 없으면 다시 받지 않는다", () => {
    expect(
      shouldReloadAiImageWorkList({
        batch: running, lastProcessed: 4, lastReloadedAt: 0, now: 1_000_000,
      }),
    ).toBe(false);
  });

  it("진행 중에는 6초 안에 거듭 다시 받지 않는다", () => {
    expect(
      shouldReloadAiImageWorkList({
        batch: running, lastProcessed: 2, lastReloadedAt: 999_000, now: 1_000_000,
      }),
    ).toBe(false);
  });

  it("배치가 끝난 순간에는 간격과 상관없이 즉시 받는다", () => {
    expect(
      shouldReloadAiImageWorkList({
        batch: { ...running, status: "completed" },
        lastProcessed: 2, lastReloadedAt: 999_999, now: 1_000_000,
      }),
    ).toBe(true);
  });

  it("배치가 없으면 아무것도 하지 않는다", () => {
    expect(
      shouldReloadAiImageWorkList({
        batch: null, lastProcessed: 0, lastReloadedAt: 0, now: 1,
      }),
    ).toBe(false);
  });
});
