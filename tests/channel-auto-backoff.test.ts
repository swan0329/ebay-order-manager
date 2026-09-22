import { describe, expect, it } from "vitest";
import {
  FAILURE_BACKOFF_MS,
  autoScheduleBlockedUntil,
  isUsageLimitError,
  nextQuotaResetAfter,
  shouldPauseAutoSchedule,
} from "@/lib/channel-auto-backoff";

describe("자동 변동 예약 쉬기", () => {
  it("실패가 없으면 쉬지 않는다", () => {
    expect(shouldPauseAutoSchedule(null)).toBe(false);
    expect(autoScheduleBlockedUntil(null)).toBeNull();
  });

  it("보통 실패는 30분 쉬고 다시 건다", () => {
    const at = new Date("2026-09-22T05:00:00.000Z");
    const failure = { at, error: "eBay 정확한 판매 옵션을 확인하지 못했습니다" };
    expect(shouldPauseAutoSchedule(failure, new Date(at.getTime() + 10 * 60 * 1000))).toBe(true);
    expect(shouldPauseAutoSchedule(failure, new Date(at.getTime() + FAILURE_BACKOFF_MS + 1))).toBe(false);
  });

  // 호출 한도는 시간이 지나야만 풀린다. 30분 뒤에 다시 걸어도 같은 답만 돌아오고
  // 남은 한도를 더 태운다.
  it("호출 한도 초과는 한도가 초기화될 때까지 쉰다", () => {
    const at = new Date("2026-09-22T05:00:00.000Z");
    const failure = { at, error: "GetItem 실패 · exceeded usage limit (오류코드 518)" };
    expect(shouldPauseAutoSchedule(failure, new Date("2026-09-22T05:40:00.000Z"))).toBe(true);
    expect(shouldPauseAutoSchedule(failure, new Date("2026-09-22T07:59:00.000Z"))).toBe(true);
    expect(shouldPauseAutoSchedule(failure, new Date("2026-09-22T08:00:01.000Z"))).toBe(false);
  });

  it("한도 초과를 오류 코드로도 문구로도 알아본다", () => {
    expect(isUsageLimitError("오류코드 518")).toBe(true);
    expect(isUsageLimitError("exceeded usage limit on this call")).toBe(true);
    expect(isUsageLimitError("다른 오류")).toBe(false);
    expect(isUsageLimitError(null)).toBe(false);
  });

  it("초기화 시각은 언제나 실패 시각 이후의 첫 08:00 UTC다", () => {
    expect(nextQuotaResetAfter(new Date("2026-09-22T05:00:00.000Z")).toISOString())
      .toBe("2026-09-22T08:00:00.000Z");
    // 이미 지난 시각이면 다음 날로 넘긴다.
    expect(nextQuotaResetAfter(new Date("2026-09-22T09:00:00.000Z")).toISOString())
      .toBe("2026-09-23T08:00:00.000Z");
    expect(nextQuotaResetAfter(new Date("2026-09-22T08:00:00.000Z")).toISOString())
      .toBe("2026-09-23T08:00:00.000Z");
  });
});
