import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
const job=JSON.parse(fs.readFileSync('.codex-tmp/feed-retry.json','utf8')).job;
const r=await fetch(base+'/api/ebay/operations?jobId='+job.id+'&verify=true',{headers:{cookie}});const b=await r.json();fs.writeFileSync('.codex-tmp/feed-verification.json',JSON.stringify(b));console.log(JSON.stringify({http:r.status,...b}));
