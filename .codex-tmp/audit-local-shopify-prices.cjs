const fs=require('fs');const {execFileSync}=require('child_process');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const remote=read('.codex-tmp/price-repair-before.json').data.products.nodes.filter(p=>p.status==='ACTIVE');
const skus=[...new Set(remote.flatMap(p=>p.variants.nodes.map(v=>v.sku)).filter(Boolean))];
const local=new Map();
for(let i=0;i<skus.length;i+=30){
 const url=new URL('https://ebay-order-manager-lake.vercel.app/api/products');url.searchParams.set('q',skus.slice(i,i+30).join('\n'));
 const output=execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','60','--header','@.codex-tmp/bts-request-headers.txt',url.href],{encoding:'utf8',maxBuffer:20*1024*1024});
 const data=JSON.parse(output);if(!Array.isArray(data.products)||data.products.length===500)throw Error('Incomplete product response');
 for(const p of data.products)if(skus.includes(p.sku))local.set(p.id,p);
 fs.writeFileSync('.codex-tmp/price-repair-local-products.json',JSON.stringify([...local.values()],null,2));
 console.log(JSON.stringify({queried:Math.min(i+30,skus.length),total:skus.length,found:local.size}));
}
