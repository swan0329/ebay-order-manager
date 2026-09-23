const fs=require('fs');const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
(async()=>{const plan=read('.codex-tmp/title-repair-plan.json');if(plan.length!==2)throw Error('Unexpected title repair scope');const c=await require('./shopify-task-client.cjs').client();const out=[];
const query='query($id:ID!){product(id:$id){id title handle variants(first:100){pageInfo{hasNextPage} nodes{id sku}}}}';
for(const p of plan){const before=(await c('/graphql.json',{query,variables:{id:p.id}})).data.product;
 if(!before||before.variants.pageInfo.hasNextPage||JSON.stringify(before.variants.nodes.map(v=>v.sku).sort())!==JSON.stringify([...p.skus].sort())||![p.before,p.title].includes(before.title))throw Error('Product changed since review');
 if(before.title!==p.title){const j=await c('/graphql.json',{query:'mutation($product:ProductUpdateInput!){productUpdate(product:$product){product{id title} userErrors{message}}}',variables:{product:{id:p.id,title:p.title}}});if(j.data.productUpdate.userErrors.length)throw Error('Title update failed');}
 const after=(await c('/graphql.json',{query,variables:{id:p.id}})).data.product;
 if(after.title!==p.title||after.handle!==before.handle||JSON.stringify(after.variants)!==JSON.stringify(before.variants))throw Error('Title verification failed');
 out.push({id:p.id,title:after.title,verified:true});fs.writeFileSync('.codex-tmp/title-repair-results.json',JSON.stringify(out,null,2));
}console.log(JSON.stringify(out));})().catch(e=>{console.error(e.message);process.exitCode=1});
