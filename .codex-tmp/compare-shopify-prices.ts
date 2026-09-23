import fs from 'node:fs';
import {resolveListingPriceUsd} from '../src/lib/listing-price';
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const remote=read('.codex-tmp/price-repair-before.json').data.products.nodes.filter((p:any)=>p.status==='ACTIVE');
const local=read('.codex-tmp/price-repair-local-products.json');
const settings=read('.codex-tmp/price-repair-settings.json').settings;
const rows=remote.flatMap((p:any)=>p.variants.nodes.map((v:any)=>{
 const matches=local.filter((x:any)=>x.sku===v.sku&&x.shopifyProductId===p.id.split('/').at(-1)&&x.shopifyVariantId===v.id.split('/').at(-1));
 const x=matches.length===1?matches[0]:undefined;
 const price=x?resolveListingPriceUsd(x,settings):null;
 const expected=price?.priceUsd.toFixed(2)??null;
 return {sku:v.sku,productId:p.id,variantId:v.id,localId:x?.id,actual:v.price,expected,source:price?.source,sourceKrw:x?.salePrice,stock:x?.stockQuantity,lastSynced:x?.shopifyLastSyncedPrice,status:!x?'UNMATCHED':!expected?'NO_PRICE':Math.abs(Number(expected)-Number(v.price))>=.01?'MISMATCH':'MATCH'};
}));
fs.writeFileSync('.codex-tmp/price-repair-comparison.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify({counts:rows.reduce((r:any,x:any)=>(r[x.status]=(r[x.status]??0)+1,r),{}),mismatch:rows.filter((x:any)=>x.status==='MISMATCH'),missing:rows.filter((x:any)=>x.status==='NO_PRICE')}));
