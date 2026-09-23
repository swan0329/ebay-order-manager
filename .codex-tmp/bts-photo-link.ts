import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base='https://ebay-order-manager-r4ih02xn2-tngks2313-9711s-projects.vercel.app';
async function main(){
 const files=JSON.parse(readFileSync('.codex-tmp/bts-photo-selected.json','utf8'));
 const before=JSON.parse(readFileSync('.codex-tmp/bts-photo-before.json','utf8'));
 const bySku=new Map(before.products.map((p:any)=>[p.sku,p]));
 if(files.some((f:any)=>!bySku.has(f.sku)))throw new Error('Missing exact SKU');
 const mode=process.argv[2]||'preview';
 const selected=mode==='sample'?files.slice(0,3):mode==='preview'?files.slice(0,100):files;
 let total=0,skipped=0;
 for(let offset=0;offset<selected.length;offset+=100){
  const chunk=selected.slice(offset,offset+100);
  if(mode!=='preview'){
   const start=Date.now();
   while(true){
    const uploads=readFileSync('.codex-tmp/bts-photo-uploads.jsonl','utf8').split('\n').filter(Boolean).flatMap(s=>{try{return [JSON.parse(s).sha256];}catch{return [];}});
    const ready=new Set(uploads);
    if(chunk.every((f:any)=>ready.has(f.sha256)))break;
    if(Date.now()-start>600000)throw new Error('Waiting for uploaded images timed out');
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
  }
  const rows=chunk.map((f:any)=>({sku:f.sku,sha256:f.sha256,fileName:f.fileName,expectedImageUrl:(bySku.get(f.sku) as any).imageUrl}));
  writeFileSync('.codex-tmp/bts-photo-request.json',JSON.stringify({confirmed:true,dryRun:mode==='preview',rows}));
  const raw=execFileSync('cmd.exe',['/d','/s','/c',`npx vercel curl /api/import/approved-photos --deployment ${base} -- --silent --show-error --fail-with-body --max-time 60 --header @.codex-tmp/bts-request-headers.txt --data-binary @.codex-tmp/bts-photo-request.json`],{encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(raw);
  if(typeof result.updated!=='number')throw new Error('Link failed');
  total+=result.updated;skipped+=result.skipped;
  appendFileSync('.codex-tmp/bts-photo-links.jsonl',JSON.stringify({mode,offset,...result})+'\n');
  console.log(JSON.stringify({mode,processed:Math.min(offset+100,selected.length),updated:total,skipped}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
