import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
process.loadEnvFile('.env');
async function main(){
 const {testR2Connection,uploadBufferToR2}=await import('../src/lib/r2');
 const manifest=JSON.parse(readFileSync('.codex-tmp/bts-photo-manifest.json','utf8'));
 const override=new Set(['112595','39818','43811','82564','8854']);
 const selected=manifest.filter((f:any)=>f.matched&&!override.has(f.sku)||/^\d+_2\.jpg$/i.test(f.fileName)).map((f:any)=>({...f,sku:f.sku??f.fileName.replace(/_2\.jpg$/i,'')}));
 writeFileSync('.codex-tmp/bts-photo-selected.json',JSON.stringify(selected,null,2));
 const connection=await testR2Connection();
 console.log(JSON.stringify({r2:connection.ok,publicBaseUrl:connection.publicBaseUrl,selected:selected.length}));
 if(process.argv[2]!=='upload')return;
 const uploaded=new Set(existsSync('.codex-tmp/bts-photo-uploads.jsonl')?readFileSync('.codex-tmp/bts-photo-uploads.jsonl','utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s).sha256):[]);
 let cursor=0,done=0;
 await Promise.all(Array.from({length:6},async()=>{
  while(cursor<selected.length){
   const file=selected[cursor++];
   if(!uploaded.has(file.sha256)){
    const buffer=readFileSync('BTS_상품번호_JPG/'+file.fileName);
    if(createHash('sha256').update(buffer).digest('hex')!==file.sha256)throw new Error('File changed: '+file.fileName);
    const key=`products/bts-approved-photos/${file.sha256}.jpg`;
    const result=await uploadBufferToR2({buffer,key,contentType:'image/jpeg'});
    appendFileSync('.codex-tmp/bts-photo-uploads.jsonl',JSON.stringify({...file,...result})+'\n');
   }
   done++;
   if(done%100===0||done===selected.length)console.log(JSON.stringify({uploaded:done,total:selected.length}));
  }
 }));
}
main().catch(e=>{console.error(e.name||'Photo upload failed');process.exitCode=1;});
