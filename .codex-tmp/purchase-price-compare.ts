import fs from 'node:fs';
import { resolveListingPriceUsd } from '../src/lib/listing-price';
const read=(name:string)=>JSON.parse(fs.readFileSync('.codex-tmp/purchase-price-'+name+'.json','utf8'));
const products=read('active-products');const bySku=new Map(products.map((p:any)=>[p.sku,p]));const settings=read('settings').settings;
const rows=read('ebay-all').items.flatMap((p:any)=>[p.Variations?.Variation??[]].flat().map((v:any)=>({itemId:p.ItemID,sku:v.SKU,price:Number(v.StartPrice?.['#text']??v.StartPrice),available:Math.max(0,Number(v.Quantity)-Number(v.SellingStatus?.QuantitySold??0))})));
const checks=rows.map((r:any)=>{const p:any=bySku.get(r.sku);if(!p)return {...r,result:'UNMATCHED'};const expected=resolveListingPriceUsd(p,settings)?.priceUsd.toNumber();return {...r,expected,sourceCheckedAt:p.pocamarketSyncedAt,result:expected===undefined?'NO_PRICE':Math.abs(expected-r.price)<0.01?'MATCH':'MISMATCH'};});
fs.writeFileSync('.codex-tmp/purchase-price-variant-checks.json',JSON.stringify(checks));console.log(JSON.stringify({checked:checks.length,resultCounts:checks.reduce((a:any,r:any)=>(a[r.result]=(a[r.result]??0)+1,a),{}),availableMismatches:checks.filter((r:any)=>r.available>0&&r.result==='MISMATCH').map((r:any)=>({sku:r.sku,actual:r.price,expected:r.expected})).slice(0,20)}));
