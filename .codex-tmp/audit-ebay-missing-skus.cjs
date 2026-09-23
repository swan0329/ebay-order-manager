const fs=require('fs'),{execFileSync}=require('child_process');
const rows=require('./channel-audit-comparison.json').filter(r=>r.status==='UNMATCHED'&&r.channel==='eBay');
const q=[...new Set(rows.map(r=>r.id))].join('\n');
const s=execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','90','--header','@.codex-tmp/bts-request-headers.txt','https://ebay-order-manager-lake.vercel.app/api/products?includePriceHistory=true&q='+encodeURIComponent(q)],{encoding:'utf8',maxBuffer:30*1024*1024});
const j=JSON.parse(s);if(!Array.isArray(j.products)||j.products.length===500)throw Error('Incomplete');fs.writeFileSync('.codex-tmp/channel-audit-missing-skus.json',JSON.stringify(j.products,null,2));
console.log(JSON.stringify({queried:rows.length,found:j.products.length,matches:rows.map(r=>({id:r.id,matches:j.products.filter(p=>p.ebayItemId===r.id).map(p=>({sku:p.sku,id:p.id,status:p.listingStatus,salePrice:p.salePrice,approved:p.finalListingPriceUsd}))}))},null,2));
