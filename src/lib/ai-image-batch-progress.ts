export type AiImageBatchProgress = {
  status: string;
  completedCount: number;
  failedCount: number;
};

export const AI_IMAGE_REFRESH_INTERVAL_MS = 6_000;

/**
 * 서버 배치가 한 장을 끝낼 때마다 그 결과는 검수 대기로 들어간다. 화면은 진행률만
 * 갱신하고 목록은 그대로 두면 검수 카드가 비어 있는 것처럼 보이므로, 처리 수가
 * 늘어나면 목록을 다시 받아야 한다. 다만 2초 간격 조회마다 다시 그리면 낭비이므로
 * 진행 중에는 간격을 두고, 배치가 끝난 순간에는 즉시 받는다.
 */
export function shouldReloadAiImageWorkList({
  batch,
  lastProcessed,
  lastReloadedAt,
  now,
}: {
  batch: AiImageBatchProgress | null;
  lastProcessed: number;
  lastReloadedAt: number;
  now: number;
}) {
  if (!batch) return false;
  const processed = batch.completedCount + batch.failedCount;
  // 첫 조회는 현재 상태를 기억만 한다. 페이지를 열 때마다 다시 그리지 않는다.
  if (lastProcessed < 0) return false;
  if (processed === lastProcessed) return false;
  if (!["queued", "running"].includes(batch.status)) return true;
  return now - lastReloadedAt >= AI_IMAGE_REFRESH_INTERVAL_MS;
}
