import fs from 'node:fs';
const result=JSON.parse(fs.readFileSync('.codex-tmp/feed-verification.json','utf8'));
const job=JSON.parse(fs.readFileSync('.codex-tmp/feed-retry-status.json','utf8')).job;
const lines=['# eBay 자동반영 운영 검증 (2026-09-07)','',`- eBay 작업: ${job.id}`,`- 처리 결과: ${job.successCount}건 성공, ${job.failureCount}건 실패`,`- 완료 시각: ${job.completedAt}`,`- 확인 보고서: ${result.reportId}`,`- eBay 보고서 생성 시각: ${result.reportCreatedAt}`,`- 보고서가 작업 완료 이후 생성됨: ${result.fresh}`,`- 가격·수량 일치: ${result.checks.filter(c=>c.verified).length}/${result.checks.length}`,'','| SKU | eBay Item ID | 요청 가격 USD | eBay 가격 USD | 요청 수량 | eBay 수량 | 일치 |','|---|---|---:|---:|---:|---:|---|',...result.checks.map(c=>`| ${c.sku} | ${c.itemId} | ${c.expectedPrice} | ${c.observedPrice} | ${c.expectedQuantity} | ${c.observedQuantity} | ${c.verified?'확인':'불일치'} |`),''];
fs.writeFileSync('docs/tracking/ebay-feed-verification-2026-09-07.md',lines.join('\n'));
