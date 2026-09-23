import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseCsvObjects } from '../src/lib/csv';
async function main(){
 const source=parseCsvObjects(readFileSync('KPOP 위탁 - 포카마켓 위탁상품 (스캔) 2026-09-07_18-02.csv','utf8'));
 const ids=new Set(source.map(r=>r['상품번호']));
 const files=[];
 for(const fileName of readdirSync('BTS_상품번호_JPG')){
  const bytes=readFileSync('BTS_상품번호_JPG/'+fileName);
  const meta=await sharp(bytes).metadata();
  if(meta.format!=='jpeg'||!meta.width||!meta.height)throw new Error('Invalid JPEG '+fileName);
  const sku=/^(\d+)\.jpg$/i.exec(fileName)?.[1]??null;
  files.push({fileName,sku,matched:!!sku&&ids.has(sku),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,width:meta.width,height:meta.height});
 }
 const report={files:files.length,exactMatches:files.filter(f=>f.matched).length,unmatched:files.filter(f=>f.sku&&!f.matched).map(f=>f.fileName),ambiguous:files.filter(f=>!f.sku).map(f=>f.fileName),uniqueImages:new Set(files.map(f=>f.sha256)).size};
 writeFileSync('.codex-tmp/bts-photo-manifest.json',JSON.stringify(files,null,2));
 writeFileSync('.codex-tmp/bts-photo-plan.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
