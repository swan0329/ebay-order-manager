const {call,save}=require('./incident-all-client.cjs');
(async()=>{
  const summary=await call('/api/pocamarket-sync/safety');if(summary.evidenceMismatch!==0)throw Error('New guard not ready or source evidence mismatch');
  save('safety-evidence-live',summary);
  const productId='c8071f57-aa5d-4e2e-87cb-2d8ac9ccc7e3';
  const source=await call('/api/pocamarket-sync/safety',{skus:['296333']});save('safety-canary-source',source);console.log(JSON.stringify({source:source.results}));
  const result=await call('/api/ebay/operations',{operation:'revise',limit:500,productIds:[productId]});save('safety-canary-submission',result);console.log(JSON.stringify({submission:result}));
  const shopify=await call('/api/products/'+productId+'/shopify-upload',{mode:'price_inventory'});save('safety-canary-shopify',shopify);console.log(JSON.stringify({shopify}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
