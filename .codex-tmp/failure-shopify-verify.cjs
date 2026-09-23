const fs=require('fs');
(async()=>{const call=await require('./shopify-task-client.cjs').client();const plan=require('./failure-shopify-plan.json');
const r=await call('/graphql.json',{query:`query($ids:[ID!]!){nodes(ids:$ids){... on Product{id status onlineStoreUrl media(first:100){nodes{status ... on MediaImage{image{url}}}} variants(first:100){nodes{sku}}}}}`,variables:{ids:plan.map(p=>'gid://shopify/Product/'+p.productId)}});
fs.writeFileSync('.codex-tmp/failure-shopify-verified.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r.data.nodes.map(p=>({id:p.id,active:p.status,url:p.onlineStoreUrl,ready:p.media.nodes.every(m=>m.status==='READY')})),null,2));
})().catch(e=>{console.error(e.message);process.exit(1)});
