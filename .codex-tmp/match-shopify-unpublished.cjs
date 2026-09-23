const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const products=JSON.parse(fs.readFileSync('.codex-tmp/shopify-unpublished.json','utf8').replace(/^\uFEFF/,'')).data.products.nodes.filter(p=>p.status==='ACTIVE'&&!p.publishedAt);
const result=[];
for(const p of products){
 const id=p.id.split('/').pop();
 const raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','30','--header','@.codex-tmp/bts-request-headers.txt',`https://ebay-order-manager-lake.vercel.app/api/products?q=${encodeURIComponent(p.variants.nodes.map(v=>v.sku).filter(Boolean).join(','))}`],{encoding:'utf8'});
 const j=JSON.parse(raw); const matches=(j.products||[]).filter(x=>x.shopifyProductId?.split('/').pop()===id);
 result.push({...p,local:matches.map(x=>({id:x.id,sku:x.sku,status:x.shopifyStatus}))});
}
fs.writeFileSync('.codex-tmp/shopify-publication-matches.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result.map(p=>({id:p.id,title:p.title,local:p.local}))));

