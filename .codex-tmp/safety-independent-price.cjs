const {read,save,call}=require('./incident-all-client.cjs');
(async()=>{
const settingsResponse=await call('/api/pricing/settings');save('safety-current-settings',settingsResponse);
const s=settingsResponse.settings??settingsResponse;
const fee=1-Number(s.ebayFeeRate)-Number(s.advertisingRate),fx=Number(s.exchangeRateKrwPerUsd),round=Number(s.roundingIncrementUsd);
if(!(fee>0&&fx>0&&round>0))throw Error('Invalid pricing configuration');
const catalog=new Map(read('reaudit-catalog').map(p=>[p.sku,p]));
const exact=read('reaudit-exact');const replaced=new Set(exact.rows.map(r=>r.itemId));
const mapping=read('mapping'), products=[...read('products'),...read('products-extra')];
const rows=[...read('reaudit-ebay').rows.filter(r=>!replaced.has(r.itemId)),...exact.rows].map(r=>{
  if(r.sku)return r;const links=mapping.local.filter(p=>p.ebayItemId===r.itemId),old=mapping.manualLinks.filter(p=>p.itemId===r.itemId);
  return {...r,sku:links.length===1?links[0].sku:old.length===1?products.find(p=>p.id===old[0].productId)?.sku:null};
});
const floor=cost=>Math.ceil((Math.max(Number(s.minimumSalePriceUsd)||0,(cost+Number(s.domesticShippingKrw)+Number(s.buyingAgencyFeeKrw))/fx*(1+Number(s.targetMarginRate))/fee)-1e-9)/round)*round;
const check=(rows,channel)=>rows.filter(r=>r.available>0&&Number(catalog.get(r.sku)?.salePrice)>0).map(r=>({sku:r.sku,itemId:r.itemId,variantId:r.variantId,price:Number(r.price),expected:Math.round(floor(Number(catalog.get(r.sku).salePrice))*100)/100,channel}));
const ebay=check(rows,'EBAY');const shopify=check(read('reaudit-shopify').rows.filter(r=>r.product.status==='ACTIVE').map(r=>({sku:r.sku,variantId:r.id,price:r.price,available:r.inventoryQuantity})),'SHOPIFY');
const summary=rows=>({checked:rows.length,underpriced:rows.filter(r=>r.price+0.009<r.expected),otherMismatch:rows.filter(r=>r.price-r.expected>0.009)});
const result={checkedAt:new Date().toISOString(),ebay:summary(ebay),shopify:summary(shopify)};save('safety-independent-price',result);console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1});
