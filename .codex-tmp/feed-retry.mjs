import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
const original=JSON.parse(fs.readFileSync('.codex-tmp/feed-diagnosis.json','utf8')).job;
const r=await fetch(base+'/api/ebay/operations',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({operation:'revise',retryJobId:original.id})});
const b=await r.json();fs.writeFileSync('.codex-tmp/feed-retry.json',JSON.stringify(b));
console.log(JSON.stringify({http:r.status,...b}));
