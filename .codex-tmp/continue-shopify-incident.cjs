const fs=require('fs');const {execFileSync}=require('child_process');
(async()=>{for(let i=0;i<600;i++){
 const j=JSON.parse(fs.readFileSync('.codex-tmp/incident-remaining-job-status.json','utf8').replace(/^\uFEFF/,'')).job;
 if(['COMPLETED','COMPLETED_WITH_ERROR'].includes(j.status)){
  if(fs.existsSync('.codex-tmp/incident-suffix-job.json'))throw Error('Suffix job already recorded; inspect before retry');
  const raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt','--header','Content-Type: application/json','--data-binary','@.codex-tmp/incident-suffix-job-input.json','https://ebay-order-manager-lake.vercel.app/api/channel-publish-jobs'],{encoding:'utf8',windowsHide:true});fs.writeFileSync('.codex-tmp/incident-suffix-job.json',raw);const next=JSON.parse(raw);if(!next.job||next.job.reusedActiveJob)throw Error('Next image job was not created');console.log(JSON.stringify({nextJob:next.job.id,total:next.job.totalCount}));
  execFileSync('node',['.codex-tmp/poll-shopify-suffix-job.cjs'],{stdio:'inherit',windowsHide:true});return;
 }
 if(['FAILED','CANCELLED'].includes(j.status))throw Error('Current job needs attention');await new Promise(r=>setTimeout(r,5000));
}throw Error('Next job wait exceeded');})().catch(e=>{console.error(e.message);process.exitCode=1});
