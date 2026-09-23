import fs from 'node:fs';
import {resolveListingPriceUsd} from '../src/lib/listing-price';
const read=(p:string)=>JSON.parse(fs.readFileSync('.codex-tmp/'+p,'utf8').replace(/^\uFEFF/,''));
const local=read('channel-audit-local.json'),settings=read('channel-audit-settings.json').settings;
for(const p of read('channel-audit-missing-skus.json'))if(!local.some((x:any)=>x.id===p.id))local.push(p);
const shop=read('channel-audit-shopify.json');
const rows:any[]=[];
function row(channel:string,sku:string,id:string,variantId:string|undefined,actual:string,currency:string,quantity:number,hold:boolean){
 const matches=local.filter((p:any)=>channel==='eBay'&&!sku?p.ebayItemId===id:p.sku===sku&&(channel==='Shopify'?String(p.shopifyProductId)===id&&String(p.shopifyVariantId)===variantId:true));
 const p=matches.length===1?matches[0]:null;
 const expected=p?resolveListingPriceUsd(p,settings)?.priceUsd.toFixed(2)??null:null;
 rows.push({channel,sku:sku||p?.sku,matchBy:sku?'SKU':'SAVED_ITEM_ID',id,variantId,actual,currency,quantity,expected,hold,localId:p?.id,linkedEbayId:p?.ebayItemId,sourceKrw:p?.salePrice,approvedUsd:p?.finalListingPriceUsd,approvedHistory:p?.listingPriceApprovals,lastSyncedPrice:channel==='Shopify'?p?.shopifyLastSyncedPrice:p?.ebayLastSyncedPrice,status:!p?'UNMATCHED':currency!=='USD'?'CURRENCY':!expected?(hold?'HELD':'NO_PRICE'):Math.abs(Number(actual)-Number(expected))>=.009?'MISMATCH':hold?'PRICED_BUT_HELD':'MATCH'});
}
for(const p of shop.products.filter((x:any)=>x.status==='ACTIVE'))for(const v of p.variants.nodes){const hold=v.metafield?.value==='true'&&v.inventoryPolicy==='DENY'&&v.inventoryItem.tracked&&v.inventoryItem.inventoryLevels.nodes.length>0&&v.inventoryItem.inventoryLevels.nodes.every((l:any)=>l.quantities.every((q:any)=>q.quantity===0));row('Shopify',v.sku,p.id.split('/').at(-1),v.id.split('/').at(-1),v.price,shop.currency,v.inventoryQuantity,hold);}
if(fs.existsSync('.codex-tmp/channel-audit-ebay.json'))for(const p of read('channel-audit-ebay.json').items){const vs=[p.variations?.Variation??[]].flat();if(vs.length)for(const v of vs)row('eBay',v.SKU,p.itemId,undefined,v.StartPrice?.['#text'],v.StartPrice?.['@_currencyID'],Number(v.Quantity)-Number(v.SellingStatus?.QuantitySold||0),false);else row('eBay',p.sku,p.itemId,undefined,p.price?.['#text'],p.price?.['@_currencyID'],Number(p.quantity)-Number(p.quantitySold||0),false);}
fs.writeFileSync('.codex-tmp/channel-audit-comparison.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify({count:rows.length,counts:rows.reduce((a:any,r:any)=>(a[r.channel+':'+r.status]=(a[r.channel+':'+r.status]||0)+1,a),{}),exceptions:rows.filter(r=>!['MATCH','HELD'].includes(r.status)).map(({approvedHistory,...r})=>r)},null,2));
