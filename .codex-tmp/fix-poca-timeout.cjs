const fs=require('fs');
const p='src/lib/pocamarket-sync.ts';let s=fs.readFileSync(p,'utf8');
fs.writeFileSync('.codex-tmp/pocamarket-sync-before-timeout-fix.ts',s);
s=s.replace(/\/\/ 한 번의 호출에서 처리할 항목 수[\s\S]*?const SYNC_CHUNK_SIZE = 12;/,'// Leave time for database persistence and reconciliation within the 60s route.\nconst SYNC_CHUNK_SIZE = 4;\nconst WORKER_LEASE_MS = 90_000;\nconst CHUNK_START_BUDGET_MS = 25_000;\nconst ITEM_REQUEST_BUDGET_MS = 8_000;');
s=s.replace('  const workerToken = randomUUID();','  const invocationStartedAt = Date.now();\n  const workerToken = randomUUID();');
s=s.replaceAll('now.getTime() - 45_000','now.getTime() - WORKER_LEASE_MS');
const start=s.indexOf('  // A serverless invocation');
const end=s.indexOf('  const config =',start);
s=s.slice(0,start)+`  try {
  // Bound recovery across invocations too: repeated termination must not loop forever.
  const staleWhere = {
    batchId,
    status: "RUNNING",
    updatedAt: { lt: new Date(now.getTime() - WORKER_LEASE_MS) },
  };
  await prisma.pocamarketSyncItem.updateMany({
    where: { ...staleWhere, retryCount: { gte: POCAMARKET_RESULT_SAVE_MAX_ATTEMPTS - 1 } },
    data: {
      status: "FAILED", deviceSerial: null, retryCount: { increment: 1 },
      errorCode: "WORKER_TIMEOUT",
      errorMessage: "작업 시간 초과가 반복되어 중단했습니다. 확인 후 다시 시도해 주세요.",
    },
  });
  await prisma.pocamarketSyncItem.updateMany({
    where: { ...staleWhere, retryCount: { lt: POCAMARKET_RESULT_SAVE_MAX_ATTEMPTS - 1 } },
    data: {
      status: "QUEUED", deviceSerial: null, retryCount: { increment: 1 },
      errorCode: "WORKER_TIMEOUT",
      errorMessage: "이전 작업이 중단되어 자동으로 다시 대기열에 넣었습니다.",
    },
  });

`+s.slice(end);
s=s.replace('  const requests: Promise<{ itemId: string; observation: Observation }>[] = [];\n\n  try {','');
s=s.replace('    take: limit,','    take: Math.max(1, Math.min(SYNC_CHUNK_SIZE, Math.floor(limit) || SYNC_CHUNK_SIZE)),');
const a=s.indexOf('  if (candidates.length) {',s.indexOf('export async function processPocamarketSyncBatch'));
const b=s.indexOf('  for (const candidate of candidates)',a);
s=s.slice(0,a)+s.slice(b);
s=s.replace('    if (stopped) break;\n    const item = candidate;',`    if (stopped || Date.now() - invocationStartedAt >= CHUNK_START_BUDGET_MS) break;
    const item = candidate;`);
const a2=s.indexOf('    if (stopped) {',a);
const b2=s.indexOf('      const requestStartedAt',a2);
s=s.slice(0,a2)+`    if (Date.now() - invocationStartedAt >= CHUNK_START_BUDGET_MS) break;
    const running = await prisma.pocamarketSyncBatch.updateMany({
      where: { id: batchId, deviceSerial: workerMarker, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "RUNNING", startedAt: batchOwner?.startedAt ? undefined : new Date() },
    });
    if (running.count !== 1) break;
    // Claim only the item being processed. Unstarted items stay QUEUED.
    const claimed = await prisma.pocamarketSyncItem.updateMany({
      where: { id: item.id, status: "QUEUED" },
      data: { status: "RUNNING", deviceSerial: workerMarker },
    });
    if (claimed.count !== 1) continue;

`+s.slice(b2);
s=s.replace('fetchPocamarketProductState(item.productNumber, config);',`fetchPocamarketProductState(item.productNumber, config, {
          deadlineAt: Date.now() + ITEM_REQUEST_BUDGET_MS,
        });`);
const a3=s.indexOf('      return { itemId: item.id, observation };',a2);
const b3=s.indexOf('  let progress =',a3);
s=s.slice(0,a3)+`    // Persist each completed item before starting the next external request.
    try {
      await recordPocamarketObservation(item.id, workerMarker, observation);
      processed += 1;
    } catch (error) {
      await recoverObservationSaveFailure(
        batchId, item.id, workerMarker, item.retryCount, error,
      );
    }
  }

`+s.slice(b3);
fs.writeFileSync(p,s);
