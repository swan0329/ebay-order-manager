# Vercel 반복 중단 조사 및 수정 (2026-09-07)

## 확인한 원인

운영 사이트는 HTTP 503 / DEPLOYMENT_PAUSED였고, 배포 자체는 Ready였다. Vercel 최근 프로젝트 중단 이벤트 10건의 사유가 모두 BUDGET_REACHED였다.

팀 Billing에서 확인한 현재 청구기간은 2026-08-11~2026-09-11이다. 포함 크레딧 $20을 전부 사용했고 추가 사용료는 $10.01, 예상 청구액은 $30.01이었다. Spend Amount가 $1이고 Pause Production Deployments가 켜져 있었다. 이 상태에서 재개만 반복하면 같은 지출 조건으로 다시 중단된다.

## 코드 수정

- 최대 12건을 미리 점유하고 모든 조회가 끝난 뒤 저장하던 처리 대신 최대 4건을 순차 처리하고 항목마다 즉시 저장한다.
- 함수 시작 후 25초가 지나면 새 조회를 시작하지 않는다. 외부 조회의 요청·재시도·백오프 전체는 항목당 8초로 제한한다.
- 작업 점유 만료를 45초에서 90초로 바꿔 60초 실행 중인 함수를 다른 호출이 중복 처리하지 못하게 한다.
- 강제 종료된 항목 복구도 재시도 횟수를 누적하고 3회 실패 시 FAILED로 남긴다.
- 초기 조회 실패 때도 작업 점유를 해제한다. 429 제한 응답은 시간 예산이 소진돼도 안전 중단으로 유지한다.

## 검증

- npm test: 62개 파일, 309개 테스트 통과.
- npm run lint: exit 0, 오류 0, 기존 경고 19.
- npm run build: exit 0.
- 신규 회귀 테스트: 다음 항목 조회 전 저장 완료, 느린 저장 뒤 미시작 항목 유지, 동시 호출의 점유 시간, 반복 timeout 제한, 초기 실패 시 점유 해제, 백오프 총 제한, 429 안전 중단.
- 운영 배포: BLOCKED. Vercel API readyStateReason은 프로젝트가 paused 상태여서 빌드할 수 없다는 응답이다. 수정본 업로드는 완료됐지만 운영 배포는 완료되지 않았다. 배포 URL https://ebay-order-manager-79l36sn2y-tngks2313-9711s-projects.vercel.app

## 남은 운영 확인

비용 한도를 임의로 올리거나 자동중단 보호를 해제하지 않았다. 비용 한도 변경 승인을 받은 뒤 프로젝트를 재개하고, HTTP 정상 응답·로그인·실제 포카마켓 진행 건수 증가·오류 로그를 검증해야 한다. 이 문서는 서비스 복구 완료 증명이 아니다.

## 2026-09-08 승인 후 운영 복구 검증

- 사용자가 40달러 설정을 명시적으로 승인했다. Billing 화면에서 $30.03 / $40 (75%), Notifications On, Pause Projects On 저장 결과를 확인했다.
- 프로젝트 재개 후 Vercel API paused=false.
- 운영 배포 dpl_5dLxVwGXni9RDoGGgjEMFPxxy5NL: READY. 기존 운영 별칭에 연결 완료.
- 배포 URL: https://ebay-order-manager-4hxzbwez2-tngks2313-9711s-projects.vercel.app
- 운영 health HTTP 200, 관리자 로그인 HTTP 200 / ADMIN, 비인증 포카마켓 배치 조회 HTTP 401, eBay 연결 조회 HTTP 200 / connected=true.
- 기존 포카마켓 배치 cmtrb5lvh0001kz045kx48jmv를 이어서 처리했다. POST process가 HTTP 200, 31,892ms, processed=4, shouldContinue=true를 반환했고 저장된 처리 수가 67→71건으로 증가했다.
- 추가 POST 없이 자동 후속 실행으로 75건까지 증가함을 확인했다. 최신화 전체 1,000건 완료를 의미하지 않는다.
- 수정본 배포 이후 조회한 최근 로그에서 해당 수동 처리와 후속 cron 호출은 HTTP 200이었다. 위 관측은 향후 모든 요청의 무오류 또는 예산 미초과를 보장하는 것은 아니다.
