const fs=require('fs'),{execFileSync}=require('child_process');
const old=JSON.parse(fs.readFileSync('.codex-tmp/channel-audit-local.json'));
const remote=JSON.parse(fs.readFileSync('.codex-tmp/bulk-images-shopify-before.json'));
const skus=[...new Set([...old.map(p=>p.sku),...remote.products.filter(p=>p.status==='ACTIVE').flatMap(p=>p.variants.nodes.map(v=>v.sku))])];const products=[];
for(let i=0;i<skus.length;i+=90){const u=new URL('https://ebay-order-manager-lake.vercel.app/api/products');u.searchParams.set('q',skus.slice(i,i+90).join('\n'));const j=JSON.parse(execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','90','--header','@.codex-tmp/bts-request-headers.txt',u.href],{encoding:'utf8',maxBuffer:64*1024*1024}));products.push(...j.products.filter(p=>skus.slice(i,i+90).includes(p.sku)));console.log('read',products.length);}
fs.writeFileSync('.codex-tmp/bulk-images-local-before.json',JSON.stringify([...new Map(products.map(p=>[p.id,p])).values()],null,2));
