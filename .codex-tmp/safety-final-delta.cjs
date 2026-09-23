const {read,save}=require('./incident-all-client.cjs');
(async()=>{
  const items=new Set(['158283707692','158281824145','158281806012','158281814368','158281818524']);
  const exact=read('reaudit-exact');exact.rows=exact.rows.filter(r=>!items.has(r.itemId)).concat(read('verified-items').filter(r=>items.has(r.itemId)));save('reaudit-exact',exact);
  const call=await require('./shopify-task-client.cjs').client();const snapshot=read('reaudit-shopify');
  const ids=['gid://shopify/ProductVariant/54299861877104','gid://shopify/ProductVariant/54293535981936'];
  const j=await call('/graphql.json',{query:'query($ids:[ID!]!){nodes(ids:$ids){...on ProductVariant{id sku price inventoryQuantity inventoryPolicy product{id status}}}}',variables:{ids}});
  if(j.errors||j.data.nodes.some(n=>!n))throw Error('Incomplete Shopify read');
  snapshot.rows=snapshot.rows.filter(r=>!ids.includes(r.id)).concat(j.data.nodes);save('reaudit-shopify',snapshot);console.log(JSON.stringify(j.data.nodes));
})().catch(e=>{console.error(e.message);process.exitCode=1});
