import { readFileSync, writeFileSync } from 'node:fs';
const before=JSON.parse(readFileSync('.codex-tmp/bts-photo-before.json','utf8'));
const after=JSON.parse(readFileSync('.codex-tmp/bts-photo-after.json','utf8'));
const selected=JSON.parse(readFileSync('.codex-tmp/bts-photo-selected.json','utf8'));
const previous=new Map(before.products.map((p:any)=>[p.sku,p]));
const current=new Map(after.products.map((p:any)=>[p.sku,p]));
const expected=new Map(selected.map((f:any)=>[f.sku,f]));
const history=new Map(after.history.map((h:any)=>[h.sku,h.count]));
const problems=[];
for(const file of selected){
 const p:any=current.get(file.sku);
 const old:any=previous.get(file.sku);
 const url=`${after.publicBaseUrl}/products/bts-approved-photos/${file.sha256}.jpg`;
 if(!p||p.imageSource!=='lens_workbench'||p.imageUrl!==url||p.ebayImageUrls.length!==1||p.ebayImageUrls[0]!==url||p.sourceImageUrl!==(old.sourceImageUrl??old.imageUrl)||history.get(file.sku)!==1)problems.push({sku:file.sku,issue:'image or approval mismatch'});
}
for(const p of after.products){
 const old:any=previous.get(p.sku);
 if(p.stockQuantity!==old.stockQuantity)problems.push({sku:p.sku,issue:'stock changed'});
 if(!expected.has(p.sku)&&(p.imageUrl!==old.imageUrl||p.imageSource!==old.imageSource))problems.push({sku:p.sku,issue:'unselected image changed'});
}
const result={targetCount:selected.length,complete:selected.filter((f:any)=>(current.get(f.sku) as any)?.imageSource==='lens_workbench').length,
 approvalCount:after.history.reduce((s:number,h:any)=>s+h.count,0),stockTotal:after.products.reduce((s:number,p:any)=>s+p.stockQuantity,0),
 overrides:selected.filter((f:any)=>f.fileName.endsWith('_2.jpg')).map((f:any)=>f.fileName),problems};
writeFileSync('.codex-tmp/bts-photo-verification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if(problems.length||result.stockTotal!==493||result.complete!==selected.length||result.approvalCount!==selected.length)process.exitCode=1;
