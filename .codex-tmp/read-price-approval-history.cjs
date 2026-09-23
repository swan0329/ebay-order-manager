const fs=require('fs');const {execFileSync}=require('child_process');const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const targets=read('.codex-tmp/price-repair-comparison.json').filter(x=>x.status==='NO_PRICE');const out=[];
for(let i=0;i<targets.length;i+=25){const url=new URL('https://ebay-order-manager-lake.vercel.app/api/products');url.searchParams.set('q',targets.slice(i,i+25).map(x=>x.sku).join('\n'));url.searchParams.set('includePriceHistory','true');const j=JSON.parse(execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','90','--header','@.codex-tmp/bts-request-headers.txt',url.href],{encoding:'utf8',maxBuffer:20*1024*1024}));
for(const t of targets.slice(i,i+25)){const p=j.products?.find(x=>x.id===t.localId);if(!p||!Array.isArray(p.listingPriceApprovals))throw Error('Missing approval history response');out.push({...t,approvals:p.listingPriceApprovals});}
fs.writeFileSync('.codex-tmp/price-approval-history.json',JSON.stringify(out,null,2));}
console.log(JSON.stringify({checked:out.length,withApprovals:out.filter(x=>x.approvals.length)}));
