const fs=require('fs');
(async()=>{
 const base='https://ebay-order-manager-lake.vercel.app';
 const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
 const before=await (await fetch(base+'/api/pocamarket-sync/batches',{headers:{cookie}})).json();
 const active=before.batches.find(b=>['QUEUED','RUNNING'].includes(b.status));
 if(!active){console.log('No active batch');return;}
 const started=Date.now();
 const r=await fetch(base+'/api/pocamarket-sync/batches/'+active.id+'/process',{method:'POST',headers:{cookie},signal:AbortSignal.timeout(70000)});
 const body=await r.json();
 const result={checkedAt:new Date().toISOString(),batchId:active.id,before:active.scannedCount,http:r.status,elapsedMs:Date.now()-started,result:body};
 fs.writeFileSync('.codex-tmp/poca-live-process-proof.json',JSON.stringify(result));
 console.log(JSON.stringify(result));
})();
