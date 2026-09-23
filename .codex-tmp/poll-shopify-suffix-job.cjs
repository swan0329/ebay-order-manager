const fs=require('fs');const {execFileSync}=require('child_process');
(async()=>{const job=JSON.parse(fs.readFileSync('.codex-tmp/incident-suffix-job.json','utf8').replace(/^\uFEFF/,'')).job;if(!job)throw Error('No job');let last='';for(let i=0;i<300;i++){
 const raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','45','--header','@.codex-tmp/bts-request-headers.txt',`https://ebay-order-manager-lake.vercel.app/api/channel-publish-jobs?jobId=${job.id}`],{encoding:'utf8'});
 fs.writeFileSync('.codex-tmp/incident-suffix-job-status.json',raw);const j=JSON.parse(raw).job;if(!j)throw Error('Missing job status');const state=JSON.stringify({status:j.status,done:j.processedCount,total:j.totalCount,success:j.successCount,failed:j.failureCount});if(state!==last){console.log(state);last=state;}if(['COMPLETED','COMPLETED_WITH_ERROR','FAILED','CANCELLED'].includes(j.status))return;await new Promise(r=>setTimeout(r,6000));
}throw Error('Audit window exceeded');})().catch(e=>{console.error(e.message);process.exitCode=1});

