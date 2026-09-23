import fs from 'node:fs';
const path='docs/tracking/ebay-feed-verification-2026-09-07.md';
const checks=JSON.parse(fs.readFileSync('.codex-tmp/feed-stability.json','utf8'));
const log=fs.readFileSync('.codex-tmp/feed-deploy-report-order.log','utf8');
const deployment=log.match(/"id": "(dpl_[^"]+)"/)?.[1];
fs.appendFileSync(path,['','## 최종 운영 확인','',`- 운영 배포: ${deployment}`,'- 운영 주소: https://ebay-order-manager-lake.vercel.app','- 전체 테스트 303개 통과, 린트 오류 0건(기존 경고 19건), 로컬·운영 빌드 통과','- 상품 오류 22건 모두 해제','- 상태 확인 HTTP 200, 비로그인 관리자 조회 HTTP 401, eBay 연결 정상, 이미지 조회 HTTP 200',...checks.map(c=>`- 반복 조회 ${c.attempt}: 보고서 ${c.reportId}, 일치 ${c.verified}/${c.total}, eBay 가격·수량 변경 필요 ${c.counts.ebay.revise}건, 동기화 ${c.sync}`),''].join('\n'));
