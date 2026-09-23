const fs=require('fs');const {execFileSync}=require('child_process');
const skus=new Set(require('./channel-audit-shopify.json').products.filter(p=>p.status==='ACTIVE').flatMap(p=>p.variants.nodes.map(v=>v.sku)).filter(Boolean));
if(fs.existsSync('.codex-tmp/channel-audit-ebay.json'))for(const p of require('./channel-audit-ebay.json').items){for(const v of [p.variations?.Variation??[]].flat())if(v.SKU)skus.add(v.SKU);if(p.sku)skus.add(p.sku)}
const previous=fs.existsSync('.codex-tmp/channel-audit-local.json')?JSON.parse(fs.readFileSync('.codex-tmp/channel-audit-local.json','utf8')):[];
const local=new Map(previous.map(p=>[p.id,p]));const known=new Set(previous.map(p=>p.sku));const list=[...skus].filter(s=>!known.has(s));
function get(path){return JSON.parse(execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt','https://ebay-order-manager-lake.vercel.app'+path],{encoding:'utf8',maxBuffer:30*1024*1024}));}
fs.writeFileSync('.codex-tmp/channel-audit-settings.json',JSON.stringify(get('/api/pricing/settings')));
for(let i=0;i<list.length;i+=100){const j=get('/api/products?includePriceHistory=true&q='+encodeURIComponent(list.slice(i,i+100).join('\n')));if(!Array.isArray(j.products)||j.products.length===500)throw Error('Incomplete response');for(const p of j.products)if(skus.has(p.sku))local.set(p.id,p);console.log(Math.min(i+100,list.length),list.length);}
fs.writeFileSync('.codex-tmp/channel-audit-local.json',JSON.stringify([...local.values()],null,2));
