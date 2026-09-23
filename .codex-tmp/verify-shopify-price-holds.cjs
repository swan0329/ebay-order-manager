const fs=require('fs'),{execFileSync}=require('child_process');
const read=p=>JSON.parse(fs.readFileSync('.codex-tmp/'+p));
const before=read('channel-audit-shopify.json'),after=read('price-hold-shopify-after.json');
const rows=read('channel-audit-comparison.json').filter(r=>r.channel==='Shopify');
const localBefore=read('channel-audit-local.json');
const ids=new Set(read('price-hold-shopify-input.json').targetIds);
const skus=localBefore.filter(p=>ids.has(p.id)).map(p=>p.sku);
if(skus.length!==55)throw Error('Missing local identities');
const url=new URL('https://ebay-order-manager-lake.vercel.app/api/products');url.searchParams.set('q',skus.join('\n'));url.searchParams.set('includePriceHistory','true');url.searchParams.set('pageSize','100');
const localResponse=JSON.parse(execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','90','--header','@.codex-tmp/bts-request-headers.txt',url.href],{encoding:'utf8'}));
fs.writeFileSync('.codex-tmp/price-hold-local-after.json',JSON.stringify(localResponse,null,2));
const locals=Array.isArray(localResponse)?localResponse:localResponse.products||localResponse.items;
if(!locals)throw Error('Unknown local response '+Object.keys(localResponse));
let matched=0,held=0,localHeld=0;const problems=[];
if(after.currency!=='USD')problems.push('Unexpected currency');
for(const p of after.products){const old=before.products.find(x=>x.id===p.id);if(!old||JSON.stringify(old.variants.nodes.map(v=>[v.id,v.sku]))!==JSON.stringify(p.variants.nodes.map(v=>[v.id,v.sku])))problems.push('Changed identity '+p.id);if(p.status!=='ACTIVE')continue;
for(const v of p.variants.nodes){const r=rows.find(r=>r.variantId===v.id.split('/').pop());if(!r){problems.push('Missing audit '+v.sku);continue;}if(r.expected!==null){if(Number(v.price)!==Number(r.expected))problems.push('Price '+v.sku);else matched++;}else{if(v.inventoryQuantity!==0||!v.inventoryItem.tracked||v.inventoryPolicy!=='DENY'||v.metafield?.value!=='true'||v.inventoryItem.inventoryLevels.nodes.some(l=>l.quantities.some(q=>q.quantity!==0)))problems.push('Hold '+v.sku);else held++;}}}
for(const id of ids){const p=locals.find(x=>x.id===id),old=localBefore.find(x=>x.id===id);if(!p){problems.push('Missing local '+id);continue;}if(p.shopifyStatus!=='PRICE_HOLD'||p.shopifyLastSyncedQuantity!==0)problems.push('Local hold '+p.sku);else localHeld++;if(p.stockQuantity!==old.stockQuantity)problems.push('Own stock changed '+p.sku);}
const result={at:new Date().toISOString(),products:after.products.length,active:after.products.filter(p=>p.status==='ACTIVE').length,matched,held,localHeld,problems};fs.writeFileSync('.codex-tmp/price-hold-shopify-verification.json',JSON.stringify(result,null,2));console.log(result);if(problems.length)process.exitCode=1;
