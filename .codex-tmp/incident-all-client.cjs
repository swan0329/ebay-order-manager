const fs=require('fs');
const cookie=fs.readFileSync('.codex-tmp/bts-request-headers.txt','utf8').split(/\r?\n/).find(x=>/^cookie:/i.test(x)).replace(/^cookie:\s*/i,'');
exports.call=async(path,body)=>{const r=await fetch('https://ebay-order-manager-lake.vercel.app'+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(290000)});const j=await r.json();if(!r.ok)throw Error('HTTP '+r.status+': '+String(j.error||'request failed').slice(0,180));return j};
exports.save=(name,data)=>fs.writeFileSync('.codex-tmp/incident-all-'+name+'.json',JSON.stringify(data,null,2));
exports.read=name=>JSON.parse(fs.readFileSync('.codex-tmp/incident-all-'+name+'.json','utf8'));
