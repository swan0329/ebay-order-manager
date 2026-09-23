const fs=require('fs');const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const before=read('.codex-tmp/price-repair-before.json').data.products.nodes;
const after=read('.codex-tmp/price-repair-after.json').data.products.nodes;
const rows=read('.codex-tmp/price-repair-comparison.json');const holds=read('.codex-tmp/price-hold-inventory-after.json');const issues=[];
let priced=0,held=0;
for(const row of rows){const p=after.find(p=>p.id===row.productId);const v=p?.variants.nodes.find(v=>v.id===row.variantId&&v.sku===row.sku);if(!v){issues.push({sku:row.sku,error:'Missing variant'});continue;}
 if(row.expected){if(Math.abs(Number(v.price)-Number(row.expected))>=.01)issues.push({sku:row.sku,error:'Price mismatch'});else priced++;}
 else{const h=holds.find(h=>h.id===v.id);if(!h||h.metafield?.value!=='true'||h.inventoryPolicy!=='DENY'||!h.inventoryItem.tracked||h.inventoryItem.inventoryLevels.nodes.some(l=>l.quantities.some(q=>q.quantity!==0)))issues.push({sku:row.sku,error:'Hold incomplete'});else held++;}
}
for(const old of before){const p=after.find(p=>p.id===old.id);if(!p){issues.push({id:old.id,error:'Missing product'});continue;}const members=x=>x.variants.nodes.map(v=>v.id+':'+v.sku).sort().join('|');const images=x=>JSON.stringify(x.media.nodes);if(members(p)!==members(old)||images(p)!==images(old)||Boolean(p.publishedAt)!==Boolean(old.publishedAt))issues.push({id:p.id,error:'Listing membership/media/publication changed'});}
const report={checked:rows.length,correctPrices:priced,held,issues,corrected:rows.filter(x=>x.status==='MISMATCH').map(x=>({sku:x.sku,before:x.actual,after:x.expected})),highPricesHeld:rows.filter(x=>Number(x.actual)>=100&&x.status==='NO_PRICE').map(x=>x.sku)};
fs.writeFileSync('.codex-tmp/price-repair-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(issues.length)process.exitCode=1;
