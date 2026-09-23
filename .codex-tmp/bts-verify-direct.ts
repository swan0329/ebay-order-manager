import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseCsvObjects } from '../src/lib/csv';
import { normalizeConsignmentRow } from '../src/lib/consignment-import';
const source='KPOP 위탁 - 포카마켓 위탁상품 (스캔) 2026-09-07_18-02.csv';
writeFileSync('.codex-tmp/bts-source.txt',source);
const raw=execFileSync('cmd.exe',['/d','/s','/c','npx vercel curl /api/import/consignment --deployment https://ebay-order-manager-3w0pm66b9-tngks2313-9711s-projects.vercel.app -- --silent --show-error --fail-with-body --max-time 60 --header @.codex-tmp/bts-request-headers.txt --get --data-urlencode brand=BTS --data-urlencode source@.codex-tmp/bts-source.txt'],{encoding:'utf8',timeout:90000,maxBuffer:20000000,stdio:['ignore','pipe','pipe']});
const result=JSON.parse(raw);
if(!Array.isArray(result.products))throw new Error('Verification failed');
const rows=parseCsvObjects(readFileSync(source,'utf8'));
const bySku=new Map(result.products.map((p:any)=>[p.sku,p]));
const failures=[];
for(const row of rows){
 const expected=normalizeConsignmentRow(row,source);
 const actual:any=bySku.get(expected.sku);
 const hash=createHash('sha256').update(expected.memo).digest('hex');
 if(!actual || actual.pocamarketId!==expected.pocamarketId || actual.stockQuantity!==expected.stockQuantity || actual.sourceHash!==hash) failures.push(expected.sku);
}
const summary={count:result.products.length,sourceRows:rows.length,stockTotal:result.products.reduce((s:number,p:any)=>s+p.stockQuantity,0),failures,movementCount:result.movementCount,movementQuantity:result.movementQuantity,uniqueMovementProducts:result.uniqueMovementProducts,invalidMovements:result.invalidMovements};
writeFileSync('.codex-tmp/bts-verification.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
if(failures.length||summary.count!==5609||summary.stockTotal!==493||summary.movementCount!==213||summary.movementQuantity!==493||summary.uniqueMovementProducts!==213||summary.invalidMovements!==0)process.exitCode=1;
