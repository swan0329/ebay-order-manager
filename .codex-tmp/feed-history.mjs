import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
const r=await fetch(base+'/api/ebay/operations?history=true',{headers:{cookie}});const body=await r.json();
console.log('history status',r.status);
if(r.ok){fs.writeFileSync('.codex-tmp/feed-history.json',JSON.stringify(body));console.log(JSON.stringify(body.jobs.map(j=>({id:j.id,status:j.status,total:j.totalCount,success:j.successCount,failure:j.failureCount,error:j.error,submitted:j.submittedAt,failedSkus:j.failures.map(f=>f.sku).slice(0,15)}))));}
