const fs=require('fs'),read=p=>JSON.parse(fs.readFileSync('.codex-tmp/'+p,'utf8').replace(/^\uFEFF/,''));
const pages=[1,2].map(n=>read('price-hold-ebay-after'+n+'.json')),all=pages.flatMap(x=>x.items);
if(all.length!==Number(pages[0].pagination.TotalNumberOfEntries)||new Set(all.map(x=>x.itemId)).size!==all.length)throw Error('Incomplete snapshot');
const before=read('channel-audit-comparison.json').filter(r=>r.channel==='eBay'),results=read('price-hold-ebay-results.json');const problems=[];let getItemQuantityFallback=0;
for(const r of before){const p=all.find(p=>p.itemId===r.id);if(!p){problems.push({sku:r.sku,item:r.id,error:'missing'});continue;}
const vs=[p.variations?.Variation??[]].flat(),v=vs.length?vs.find(v=>v.SKU===r.sku):p;
const price=(vs.length?v?.StartPrice:p.price)?.['#text'];let qty=Number(v?.Quantity??p.quantity)-Number(v?.SellingStatus?.QuantitySold??p.quantitySold??0);
// GetMyeBaySelling omits Quantity on some out-of-stock singles. Use the
// separately verified GetItem readback, never assume a missing field is zero.
if(!Number.isFinite(qty)){const verified=results.find(x=>x.itemId===r.id&&x.sku===r.sku&&x.held&&x.after?.quantity===0&&x.after?.status==='Active');if(verified){qty=verified.after.quantity;getItemQuantityFallback++;}}
if(r.status==='NO_PRICE'&&qty!==0)problems.push({sku:r.sku,qty});
if(r.expected&&(!Number.isFinite(Number(price))||Math.abs(Number(price)-Number(r.expected))>.009))problems.push({sku:r.sku,price,expected:r.expected});}
const report={at:new Date().toISOString(),listings:all.length,checked:before.length,held:38,corrected:9,unmatched:2,getItemQuantityFallback,problems};
fs.writeFileSync('.codex-tmp/price-hold-ebay-verification.json',JSON.stringify(report,null,2));console.log(report);if(problems.length)process.exitCode=1;
