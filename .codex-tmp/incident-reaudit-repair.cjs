const {call,read,save}=require('./incident-all-client.cjs');
(async()=>{const products=read('reaudit-six-products');
 const job=await call('/api/ebay/operations',{operation:'revise',limit:500,productIds:products.map(p=>p.id)});save('reaudit-six-ebay-job',job);console.log('ebay',JSON.stringify(job));
 const result=[];for(const p of products){if(!p.shopifyProductId||!p.shopifyVariantId||!p.shopifyInventoryItemId)throw Error('Missing Shopify IDs '+p.sku);const r=await call('/api/products/'+p.id+'/shopify-upload',{mode:'price_inventory'});result.push({sku:p.sku,result:r});save('reaudit-six-shopify-repair',result);console.log('shopify corrected',p.sku)}
})().catch(e=>{console.error(e.message);process.exitCode=1});
