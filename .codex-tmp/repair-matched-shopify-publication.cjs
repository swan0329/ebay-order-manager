const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const products=JSON.parse(fs.readFileSync('.codex-tmp/shopify-publication-matches.json','utf8')).filter(p=>p.local.length);
const results=[];
for(const p of products){
 const id=p.local[0].id;
 const headers=execFileSync('curl.exe',['--silent','--show-error','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt','--header','Content-Type: application/json','--data','{"confirmed":true}','--dump-header','-','--output',`.codex-tmp/publish-${id}.html`,`https://ebay-order-manager-lake.vercel.app/api/products/${id}/shopify-link`],{encoding:'utf8'});
 results.push({id:p.id,localId:id,status:headers.split('\r\n')[0],url:headers.match(/location: (.+)/i)?.[1].trim()});
 fs.writeFileSync('.codex-tmp/shopify-bulk-publication-results.json',JSON.stringify(results,null,2));
}
console.log(JSON.stringify(results));
