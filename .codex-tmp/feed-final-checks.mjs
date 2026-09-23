import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
const targets=JSON.parse(fs.readFileSync('.codex-tmp/feed-retry.json','utf8')).job.targets;
const checks=[];
for(let i=0;i<targets.length;i+=3){checks.push(...await Promise.all(targets.slice(i,i+3).map(async t=>{const r=await fetch(base+'/api/products?q='+encodeURIComponent(t.sku),{headers:{cookie}});const b=await r.json();const p=b.products?.find(p=>p.sku===t.sku);return {sku:t.sku,http:r.status,error:p?.uploadError,found:!!p,image:p?.ebayImageUrls?.[0]};})));}
const countResponse=await fetch(base+'/api/products/channel-operation-counts',{headers:{cookie}});
const counts=await countResponse.json();
const health=await fetch(base+'/api/health');
const unauthorized=await fetch(base+'/api/ebay/operations?history=true');
const connection=await fetch(base+'/api/ebay/connection-status',{headers:{cookie}});
const connectionBody=await connection.json();
const image=checks.find(c=>c.image)?.image;
const imageStatus=image?(await fetch(image,{method:'HEAD'})).status:null;
const result={checkedAt:new Date().toISOString(),productsChecked:checks.length,errorsCleared:checks.filter(c=>c.found&&c.error===null).length,counts,health:health.status,unauthorized:unauthorized.status,ebayConnected:connectionBody.ok,imageStatus};
fs.writeFileSync('.codex-tmp/feed-final-checks.json',JSON.stringify(result));console.log(JSON.stringify(result));
