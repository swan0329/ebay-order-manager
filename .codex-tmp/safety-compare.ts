import fs from 'node:fs';
import { resolveListingPriceUsd } from '../src/lib/listing-price';
import { listingQuantity } from '../src/lib/listing-quantity';
const read=(n:string)=>JSON.parse(fs.readFileSync('.codex-tmp/incident-all-'+n+'.json','utf8'));
const products:any[]=read('safety-current-products');const bySku=new Map(products.map(p=>[p.sku,p]));
if(products.length!==2250||bySku.size!==2250)throw Error('Current product audit incomplete');
const settings=read('settings').settings;const mapping=read('mapping');
const exact=read('reaudit-exact');if(exact.errors.length)throw Error('Exact eBay reads incomplete');
const replaced=new Set(exact.rows.map((r:any)=>r.itemId));
const ebayRows=[...read('reaudit-ebay').rows.filter((r:any)=>!replaced.has(r.itemId)),...exact.rows];
const ebay=ebayRows.map((r:any)=>{
 const linked=mapping.local.filter((p:any)=>p.ebayItemId===r.itemId);
 const historical=mapping.manualLinks.filter((p:any)=>p.itemId===r.itemId);
 const prior=historical.length===1?products.find(p=>p.id===historical[0].productId):null;
 const p=bySku.get(r.sku??(!r.variation&&linked.length===1?linked[0].sku:prior?.sku));
 if(!p)return {...r,result:r.available===0?'UNLINKED_HELD':'UNMATCHED'};
 const replacement=mapping.savedGroups.find((g:any)=>g.ebayItemId!==r.itemId&&g.includedProductIds.includes(p.id));
 if(!r.sku&&!r.variation&&(prior&&p.ebayItemId!==r.itemId||replacement))return {...r,sku:p.sku,result:r.available===0?'ORPHAN_HELD':'ORPHAN_ACTIVE'};
 const expected=Number(resolveListingPriceUsd(p,settings)?.priceUsd)||null;const expectedQuantity=expected===null?0:listingQuantity(p);
 return {...r,sku:p.sku,productId:p.id,brand:p.brand,cost:p.salePrice,sourceCheckedAt:p.pocamarketSyncedAt,expected,expectedQuantity,
   quantityMismatch:r.available!==expectedQuantity,
   result:r.available===null?'UNKNOWN_QUANTITY':r.available===0?'HELD':r.currency!=='USD'?'CURRENCY_UNKNOWN':!expected||!expectedQuantity?'SHOULD_HOLD':Math.abs(expected-r.price)<.01?'MATCH':expected>r.price?'UNDERPRICED':'OVERPRICED'};
});
const shopify=read('reaudit-shopify').rows.filter((r:any)=>r.product.status==='ACTIVE').map((r:any)=>{
 const p=bySku.get(r.sku);if(!p||!r.id.endsWith('/'+p.shopifyVariantId))return {sku:r.sku,result:'UNMATCHED'};
 const expected=Number(resolveListingPriceUsd(p,settings)?.priceUsd)||null;const expectedQuantity=expected===null?0:listingQuantity(p);
 return {sku:r.sku,productId:p.id,brand:p.brand,variantId:r.id,price:Number(r.price),available:r.inventoryQuantity,expected,expectedQuantity,quantityMismatch:r.inventoryQuantity!==expectedQuantity,
   result:r.inventoryPolicy==='CONTINUE'?'OVERSELL_ENABLED':r.inventoryQuantity<=0?'HELD':!expected||!expectedQuantity?'SHOULD_HOLD':Math.abs(expected-Number(r.price))<.01?'MATCH':expected>Number(r.price)?'UNDERPRICED':'OVERPRICED'};
});
const summarize=(rows:any[])=>({total:rows.length,counts:rows.reduce((a,r)=>(a[r.result]=(a[r.result]??0)+1,a),{}),quantityMismatch:rows.filter(r=>r.quantityMismatch).length,
 issues:rows.filter(r=>!['MATCH','HELD','ORPHAN_HELD'].includes(r.result)||r.quantityMismatch)});
const report={checkedAt:new Date().toISOString(),ebay:summarize(ebay),shopify:summarize(shopify)};
fs.writeFileSync('.codex-tmp/incident-all-safety-comparison.json',JSON.stringify({report,ebay,shopify},null,2));
console.log(JSON.stringify(report,null,2));
