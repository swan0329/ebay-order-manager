const {call,read,save}=require('./incident-all-client.cjs');
(async()=>{
  const wanted=new Map([...read('products'),...read('products-extra')].map(p=>[p.id,p.sku]));
  const found=new Map();const skus=[...wanted.values()];
  let index=0;
  async function worker(){while(index<skus.length){const i=index;index+=500;
    const requested=skus.slice(i,i+500);
    const j=await call('/api/products?skus='+encodeURIComponent(requested.join(',')));
    const rows=Array.isArray(j)?j:j.products;
    if(!Array.isArray(rows))throw Error('products response shape');
    if(rows.some(p=>!requested.includes(p.sku)))throw Error('Exact SKU endpoint not deployed');
    for(const p of rows)if(wanted.has(p.id))found.set(p.id,p);
    save('safety-current-products',[...found.values()]);console.log(JSON.stringify({batch:i,found:found.size}));
  }}
  await worker();
  const missing=[...wanted.keys()].filter(id=>!found.has(id));console.log(JSON.stringify({missing:missing.length}));let missingIndex=0;
  async function fill(){while(missingIndex<missing.length){const id=missing[missingIndex++];
    const j=await call('/api/products/'+id);const p=j.product??j;
    const fields=['id','sku','brand','salePrice','finalListingPriceUsd','stockQuantity','pocamarketId','pocamarketAvailableCount','pocamarketSyncedAt','pocamarketLastAttemptAt','lastUploadedAt','ebayPrice','ebayLastSyncedPrice','ebayItemId','shopifyProductId','shopifyVariantId','shopifyInventoryItemId','isSoldOut'];
    found.set(id,Object.fromEntries(fields.map(k=>[k,p[k]])));
    save('safety-current-products',[...found.values()]);console.log(JSON.stringify({found:found.size}));
  }}
  await Promise.all([fill(),fill(),fill()]);
  save('safety-current-products',[...found.values()]);console.log(JSON.stringify({products:found.size,wanted:wanted.size}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
