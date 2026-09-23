const fs=require('fs');
(async()=>{
const call=await require('./shopify-task-client.cjs').client();
const r=await call('/graphql.json',{query:`{product(id:"gid://shopify/Product/15252533510512"){id title status onlineStoreUrl media(first:20){nodes{id status ... on MediaImage{image{url width height}}}} variants(first:10){nodes{id sku price inventoryQuantity inventoryPolicy}}}}`});
if(r.errors||!r.data?.product)throw Error('Product read failed');
fs.writeFileSync('.codex-tmp/101214-'+process.argv[2]+'.json',JSON.stringify(r.data.product,null,2));
console.log(JSON.stringify({stage:process.argv[2],...r.data.product}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
