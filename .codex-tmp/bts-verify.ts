import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsvObjects } from '../src/lib/csv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=readFileSync('.codex-tmp/feed-session.txt','utf8');
const source='KPOP 위탁 - 포카마켓 위탁상품 (스캔) 2026-09-07_18-02.csv';
async function read(url:string){
 const r=await run('curl.exe',['--silent','--show-error','--fail','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt',url],{maxBuffer:20000000});
 return r.stdout;
}
async function main(){
 const rows=parseCsvObjects(readFileSync(source,'utf8'));
 const found=new Map<string,any>();
 for(let offset=0;offset<rows.length;offset+=300){
  const chunks=[0,100,200].map(n=>rows.slice(offset+n,offset+n+100)).filter(c=>c.length);
  const results=await Promise.all(chunks.map(async chunk=>{
   const url=base+'/api/products?group=BTS&q='+encodeURIComponent(chunk.map(r=>r['상품번호']).join('\n'));
   return JSON.parse(await read(url)).products;
  }));
  for(const products of results) for(const p of products) found.set(p.sku,p);
  console.log('Verified queries',Math.min(offset+300,rows.length));
 }
 const failures=[];
 for(const row of rows){
  const p=found.get(row['상품번호']);
  if(!p){failures.push({sku:row['상품번호'],issue:'missing'});continue;}
  const original=JSON.parse(p.memo).importedRow;
  if(p.pocamarketId!==row['상품번호']||p.brand!=='BTS'||p.stockQuantity!==Number(row['보유 재고']||0)||JSON.stringify(original)!==JSON.stringify(row)) failures.push({sku:p.sku,issue:'field mismatch'});
 }
 const movements=parseCsvObjects(await read(base+'/api/export/inventory-movements')).filter(r=>r.reason===`위탁 상품대장 가져오기: ${source}`);
 const result={sourceRows:rows.length,found:rows.filter(r=>found.has(r['상품번호'])).length,failures,
  stockTotal:rows.reduce((sum,r)=>sum+(found.get(r['상품번호'])?.stockQuantity??0),0),
  movementCount:movements.length,movementQuantity:movements.reduce((sum,r)=>sum+Number(r.quantity),0),
  uniqueMovementSkus:new Set(movements.map(r=>r.sku)).size};
 writeFileSync('.codex-tmp/bts-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 if(failures.length||result.found!==5609||result.stockTotal!==493||result.movementCount!==213||result.uniqueMovementSkus!==213||result.movementQuantity!==493)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
