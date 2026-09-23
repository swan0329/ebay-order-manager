import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
const job=JSON.parse(fs.readFileSync('.codex-tmp/feed-retry.json','utf8')).job;
const results=[];
for(let attempt=1;attempt<=2;attempt++){
 const r=await fetch(base+'/api/ebay/operations?jobId='+job.id+'&verify=true',{headers:{cookie},signal:AbortSignal.timeout(90000)});
 const verification=await r.json();
 const c=await fetch(base+'/api/products/channel-operation-counts',{headers:{cookie},signal:AbortSignal.timeout(60000)});
 const counts=await c.json();
 const result={attempt,http:r.status,reportId:verification.reportId,reportCreatedAt:verification.reportCreatedAt,fresh:verification.fresh,verified:verification.checks?.filter(x=>x.verified).length,total:verification.checks?.length,sync:verification.sync?.status,counts};
 results.push(result); console.log(JSON.stringify(result));
 fs.writeFileSync('.codex-tmp/feed-verification.json',JSON.stringify(verification));
}
fs.writeFileSync('.codex-tmp/feed-stability.json',JSON.stringify(results));
