const {save}=require('./incident-all-client.cjs');
(async()=>{const call=await require('./shopify-task-client.cjs').client();
const j=await call('/graphql.json',{query:'query{shop{currencyCode} productVariant(id:"gid://shopify/ProductVariant/54293535981936"){id sku price inventoryQuantity inventoryPolicy metafield(namespace:"order_manager",key:"price_review_required"){value} inventoryItem{id tracked}}}'});
if(j.errors)throw Error('Shopify verification failed');save('safety-canary-shopify-actual',j.data);console.log(JSON.stringify(j.data));
})().catch(e=>{console.error(e.message);process.exitCode=1});
