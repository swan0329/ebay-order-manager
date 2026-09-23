const fs=require('fs');const {call,save}=require('./incident-all-client.cjs');
(async()=>{
 const fields=['id','sku','brand','productName','salePrice','costPrice','stockQuantity','pocamarketId','pocamarketSyncedAt','lastUploadedAt','createdAt','updatedAt','ebayItemId','ebayPrice','ebayLastSyncedPrice','listingPriceApprovals'];
 const j=await call('/api/products?includePriceHistory=true&q='+encodeURIComponent(['296333','284272','284806','287832'].join('\n')));
 const history=j.products.map(p=>Object.fromEntries(fields.map(k=>[k,p[k]])));save('reaudit-four-history',history);console.log(JSON.stringify(history));
 const old=JSON.parse(fs.readFileSync('.codex-tmp/procurement-source-suspects.json','utf8'));console.log('historical contaminated',old.length);
 const c=fs.readFileSync('.codex-tmp/incident-all-fetch.cjs','utf8').replace("save('ebay'","save('reaudit-ebay'");fs.writeFileSync('.codex-tmp/incident-reaudit-fetch.cjs',c);
 const s=fs.readFileSync('.codex-tmp/incident-all-shopify.cjs','utf8').replace("save('shopify'","save('reaudit-shopify'");fs.writeFileSync('.codex-tmp/incident-reaudit-shopify.cjs',s);
 const cat=fs.readFileSync('.codex-tmp/incident-all-catalog.cjs','utf8').replace("save('catalog'","save('reaudit-catalog'").replace("save('catalog-suspects'","save('reaudit-catalog-suspects'").replace('costPrice:p.cost_price','brand:p.brand,productName:p.product_name,costPrice:p.cost_price');fs.writeFileSync('.codex-tmp/incident-reaudit-catalog.cjs',cat);
})().catch(e=>{console.error(e.message);process.exitCode=1});
