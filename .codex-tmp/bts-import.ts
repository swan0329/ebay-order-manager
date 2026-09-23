import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsvObjects } from '../src/lib/csv';
async function main() {
 const base='https://ebay-order-manager-lake.vercel.app';
 const cookie=readFileSync('.codex-tmp/feed-session.txt','utf8');
 const rows = parseCsvObjects(readFileSync('KPOP 위탁 - 포카마켓 위탁상품 (스캔) 2026-09-07_18-02.csv','utf8'));
 const ids = rows.map(r=>r['상품번호']);
 const response=await fetch(base+'/api/export/products',{headers:{cookie}});
 if(!response.ok) throw new Error('Backup failed');
 const backup=await response.text();
 writeFileSync('.codex-tmp/bts-before-products.csv',backup);
 const all=parseCsvObjects(backup);
 const existing=all.filter(r=>ids.includes(r.sku)||ids.includes(r.pocamarket_id));
 const summary = {rows:rows.length, unique:new Set(ids).size, groups:[...new Set(rows.map(r=>r['그룹명']))], nonempty:Object.fromEntries(Object.keys(rows[0]).map(k=>[k,rows.filter(r=>r[k] && !['FALSE','pending'].includes(r[k])).length])), existing:existing.length, sample:rows.slice(0,2), backupRows:all.length, backupColumns:Object.keys(all[0]??{}), reference:all.filter(r=>JSON.stringify(r).includes('Stray')).slice(0,1)};
 console.log(JSON.stringify(summary,null,2));
 writeFileSync('.codex-tmp/bts-import-preview.json',JSON.stringify({summary,existing},null,2));
}
main().catch(()=>{console.error('BTS preview failed; no changes made.');process.exitCode=1;});
