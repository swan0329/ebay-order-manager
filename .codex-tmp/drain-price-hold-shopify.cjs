const fs=require('fs'),{execFileSync}=require('child_process');
const jobId=process.argv[2]||'cmtv6twm20001l80401uthhyb';
(async()=>{let last=-1;for(let i=0;i<500;i++){
const s=execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt','https://ebay-order-manager-lake.vercel.app/api/channel-publish-jobs?jobId='+jobId],{encoding:'utf8'});
const j=JSON.parse(s);fs.writeFileSync('.codex-tmp/price-hold-shopify-progress.json',s);if(j.job.processedCount!==last){last=j.job.processedCount;console.log(JSON.stringify({id:jobId,done:last,total:j.job.totalCount,failed:j.job.failureCount,status:j.job.status}));}
if(['COMPLETED','COMPLETED_WITH_ERROR','FAILED','CANCELED'].includes(j.job.status))break;await new Promise(r=>setTimeout(r,2000));
}})().catch(e=>{console.error(e.message);process.exitCode=1});
