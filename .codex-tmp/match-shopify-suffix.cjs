const fs=require('fs');const {execFileSync}=require('child_process');
const all=JSON.parse(fs.readFileSync('.codex-tmp/incident-all-media.json','utf8').replace(/^\uFEFF/,'')).data.products.nodes;
const ids=new Set(JSON.parse(fs.readFileSync('.codex-tmp/shopify-incident-suffix-unpublished.json','utf8')).map(p=>p.id));
const selected=all.filter(p=>ids.has(p.id));
const q=selected.map(p=>p.variants.nodes[0].sku).join('\n');
const raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt',`https://ebay-order-manager-lake.vercel.app/api/products?q=${encodeURIComponent(q)}`],{encoding:'utf8'});
const products=JSON.parse(raw).products;fs.writeFileSync('.codex-tmp/incident-suffix-local-products.json',JSON.stringify(products,null,2));
const matched=selected.map(p=>({id:p.id,localId:products.find(x=>x.shopifyProductId===p.id.split('/').pop())?.id}));fs.writeFileSync('.codex-tmp/incident-suffix-matches.json',JSON.stringify(matched,null,2));console.log(JSON.stringify({matched:matched.filter(p=>p.localId).length,missing:matched.filter(p=>!p.localId)}));

