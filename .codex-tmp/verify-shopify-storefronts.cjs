const fs=require('node:fs');
(async()=>{
const rows=JSON.parse(fs.readFileSync('.codex-tmp/shopify-bulk-publication-results.json','utf8'));
rows.push({url:'https://krazykpop.net/products/stray-kids-noeasy'});
const results=[];
for(const p of rows){const r=await fetch(p.url); const html=await r.text(); results.push({url:p.url,status:r.status,title:html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim()});}
fs.writeFileSync('.codex-tmp/shopify-storefront-verification.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({checked:results.length,failed:results.filter(p=>p.status!==200||!p.title||/404|not found/i.test(p.title))}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
