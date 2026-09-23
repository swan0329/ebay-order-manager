import fs from 'node:fs';
const base='https://ebay-order-manager-lake.vercel.app';
const cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');
for (const sku of ['182221','182222','182226','182229','182232','182234','182291','18432']) {
const r=await fetch(base+'/api/products?q='+sku,{headers:{cookie}});const b=await r.json();console.log(JSON.stringify({sku,status:r.status,products:b.products?.filter(p=>p.sku===sku).map(p=>({id:p.id,sku:p.sku,itemId:p.ebayItemId,offerId:p.ebayOfferId,listingStatus:p.listingStatus,error:p.uploadError,lastPrice:p.ebayLastSyncedPrice,lastQuantity:p.ebayLastSyncedQuantity}))}));
}
