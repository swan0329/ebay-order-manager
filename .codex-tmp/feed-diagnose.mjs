import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
const history=JSON.parse(fs.readFileSync('.codex-tmp/feed-history.json','utf8'));
const job=history.jobs.find(j=>j.failures.some(f=>f.sku==='182221'));
if(!job)throw new Error('Matching job missing');
const r=await fetch(base+'/api/ebay/operations?jobId='+job.id+'&diagnose=true',{headers:{cookie}});const body=await r.json();fs.writeFileSync('.codex-tmp/feed-diagnosis.json',JSON.stringify(body));console.log(JSON.stringify({http:r.status,id:job.id,total:job.totalCount,success:body.succeeded?.length,responseCount:body.responseCount,failures:body.failures?.slice(0,10),unmatched:body.unmatchedErrors,error:body.error}));
