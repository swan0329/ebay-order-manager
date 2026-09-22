/**
 * 자동 변동 예약을 잠시 쉬어야 하는지 판단한다.
 *
 * 5분마다 예약을 거는 구조에서 작업이 실패하면 5분 뒤 같은 작업을 또 건다. 실패
 * 원인이 그대로면 결과도 그대로이고, eBay 호출만 계속 태운다. 2026-09-22에 이것이
 * eBay 일일 호출 한도를 소진시켜 수량 되돌리기까지 막았다.
 */

/** 보통 실패 뒤 쉬는 시간 */
export const FAILURE_BACKOFF_MS = 30 * 60 * 1000;

/**
 * eBay 일일 호출 한도는 태평양시 자정에 초기화된다. 서머타임이면 07:00 UTC,
 * 아니면 08:00 UTC다. 늦게 재개하는 편이 안전하므로 08:00 UTC를 쓴다.
 */
const QUOTA_RESET_UTC_HOUR = 8;

export function nextQuotaResetAfter(at: Date) {
  const reset = new Date(at);
  reset.setUTCHours(QUOTA_RESET_UTC_HOUR, 0, 0, 0);
  if (reset <= at) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

export type LastFailure = {
  at: Date;
  error: string | null;
} | null;

/** 호출 한도 초과는 시간이 지나야만 풀린다. 다른 실패와 쉬는 기간이 다르다. */
export function isUsageLimitError(error: string | null | undefined) {
  return Boolean(error && (error.includes("518") || error.includes("exceeded usage limit")));
}

export function autoScheduleBlockedUntil(failure: LastFailure): Date | null {
  if (!failure) return null;
  return isUsageLimitError(failure.error)
    ? nextQuotaResetAfter(failure.at)
    : new Date(failure.at.getTime() + FAILURE_BACKOFF_MS);
}

export function shouldPauseAutoSchedule(failure: LastFailure, now = new Date()) {
  const until = autoScheduleBlockedUntil(failure);
  return Boolean(until && now < until);
}
