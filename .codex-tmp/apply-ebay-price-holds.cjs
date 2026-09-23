const fs=require('fs'),{execFileSync}=require('child_process');
const cli='C:/Users/SUHAN/AppData/Local/npm-cache/_npx/01fe0689eda981a6/node_modules/vercel/dist/index.js';
const targets=require('./channel-audit-comparison.json').filter(r=>r.channel==='eBay'&&['NO_PRICE','MISMATCH'].includes(r.status));
const done=fs.existsSync('.codex-tmp/price-hold-ebay-results.json')?JSON.parse(fs.readFileSync('.codex-tmp/price-hold-ebay-results.json','utf8')):[];
for(const t of targets){if(done.some(r=>r.itemId===t.id&&r.sku===t.sku&&!r.error&&r.after))continue;
 const file='.codex-tmp/price-hold-ebay-request.json';fs.writeFileSync(file,JSON.stringify({productId:t.localId,itemId:t.id,confirmed:true,priceOnly:t.status==='MISMATCH'}));
 const raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','120','--header','@.codex-tmp/bts-request-headers.txt','--header','Content-Type: application/json','--request','POST','--data-binary','@'+file,'https://ebay-order-manager-lake.vercel.app/api/admin/price-lifecycle-repair'],{encoding:'utf8',maxBuffer:3*1024*1024,stdio:['ignore','pipe','pipe']});
 const j=JSON.parse(raw.replace(/^\uFEFF/,''));done.push({...j,requestedSku:t.sku,itemId:t.id});fs.writeFileSync('.codex-tmp/price-hold-ebay-results.json',JSON.stringify(done,null,2));console.log(JSON.stringify({sku:t.sku,...(j.error?{error:j.error}:{held:j.held,quantity:j.after?.quantity}),done:done.length,total:targets.length}));if(j.error)break;
}
