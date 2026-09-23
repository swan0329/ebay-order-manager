const fs=require('fs');
(async()=>{const call=await require('./shopify-task-client.cjs').client();
const r=await call('/graphql.json',{query:`{products(first:100,sortKey:UPDATED_AT,reverse:true,query:"published_status:unpublished status:active"){nodes{id title updatedAt onlineStoreUrl media(first:100){nodes{id status ... on MediaImage{image{url} mediaErrors{code message}}}} variants(first:100){nodes{id sku image{url}}}}}}`});
fs.writeFileSync('.codex-tmp/failure-shopify-remote.json',JSON.stringify(r,null,2));
console.log(JSON.stringify(r.data.products.nodes.map(p=>({id:p.id,skus:p.variants.nodes.map(v=>v.sku),images:p.media.nodes.map(m=>({status:m.status,url:m.image?.url,errors:m.mediaErrors}))})),null,2));
})().catch(e=>{console.error(e.message);process.exit(1)});
