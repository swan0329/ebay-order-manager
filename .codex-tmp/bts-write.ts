import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { parseCsvObjects } from '../src/lib/csv';
import { normalizeConsignmentRow } from '../src/lib/consignment-import';
import { execFileSync } from 'node:child_process';
const source='KPOP 위탁 - 포카마켓 위탁상품 (스캔) 2026-09-07_18-02.csv';
const base='https://ebay-order-manager-g3e296w3g-tngks2313-9711s-projects.vercel.app';
const cookie=readFileSync('.codex-tmp/feed-session.txt','utf8');
async function main(){
 const rows=parseCsvObjects(readFileSync(source,'utf8'));
 const validated=rows.map(r=>normalizeConsignmentRow(r,source));
 if(new Set(validated.map(p=>p.sku)).size!==rows.length || validated.some(p=>p.brand!=='BTS')) throw new Error('Source validation failed');
 console.log(JSON.stringify({rows:rows.length,stock:validated.reduce((s,p)=>s+p.stockQuantity,0),stockProducts:validated.filter(p=>p.stockQuantity>0).length}));
 const mode=process.argv[2]||'preview';
 const selected=mode==='sample'?rows.slice(0,3):mode==='preview'?rows.slice(0,100):rows;
 writeFileSync('.codex-tmp/bts-request-headers.txt',`Cookie: ${cookie}\nContent-Type: application/json\n`);
 let total=0,skipped=0;
 for(let i=0;i<selected.length;i+=100){
  writeFileSync('.codex-tmp/bts-request.json',JSON.stringify({source,dryRun:mode==='preview',rows:selected.slice(i,i+100)}));
  const raw=execFileSync('cmd.exe',['/d','/s','/c',`npx vercel curl /api/import/consignment --deployment ${base} -- --silent --show-error --fail-with-body --max-time 60 --header @.codex-tmp/bts-request-headers.txt --data-binary @.codex-tmp/bts-request.json`],{encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(raw);
  if(result.error || typeof result.created!=='number') throw new Error('Import response failed');
  total+=result.created; skipped+=result.skipped;
  appendFileSync('.codex-tmp/bts-import-progress.jsonl',JSON.stringify({at:new Date().toISOString(),mode,offset:i,...result})+'\n');
  console.log(JSON.stringify({mode,processed:Math.min(i+100,selected.length),total,skipped,...result}));
 }
 writeFileSync('.codex-tmp/bts-import-'+mode+'-result.json',JSON.stringify({total,skipped,rows:selected.length}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
