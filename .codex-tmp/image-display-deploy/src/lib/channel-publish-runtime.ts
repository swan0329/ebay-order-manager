// Every worker entry point has maxDuration=300. Keep the lease longer than a
// live invocation so UI polls and cron cannot reclaim work that is still running.
export const channelPublishLeaseMs = 360_000;
export class PublishContinuationError extends Error {
  constructor() { super("이미지 준비 결과를 저장했습니다. 다음 실행에서 등록을 이어갑니다."); }
}
