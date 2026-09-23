const fs = require('fs');
const auth = JSON.parse(fs.readFileSync(process.env.APPDATA + '/com.vercel.cli/Data/auth.json','utf8'));
(async()=>{
 const r=await fetch('https://api.vercel.com/v1/billing/charges?teamId=team_9dUKn9F1VUpGxnxJnzdF6EDw&from=2026-08-11T00:00:00Z&to=2026-09-08T00:00:00Z',{headers:{Authorization:'Bearer '+auth.token}});
 const body=await r.text(); if(!r.ok){console.log(r.status,body.slice(0,200));return;}
 fs.writeFileSync('.codex-tmp/billing-charges.jsonl',body);
 const rows=body.trim().split('\n').map(x=>JSON.parse(x));
 console.log('keys',Object.keys(rows[0]||{}));
 const grouped={};for(const row of rows){const name=row.ServiceName||row.serviceName||'unknown';grouped[name]=(grouped[name]||0)+Number(row.BilledCost||0)}console.log(grouped);
})();
