const fs=require('fs');const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
(async()=>{const history=read('.codex-tmp/price-approval-history.json');if(history.length!==55)throw Error('Incomplete approval audit');const targets=history.filter(x=>!x.approvals.length);const before=read('.codex-tmp/price-hold-inventory-before.json');const c=await require('./shopify-task-client.cjs').client();const results=[];
for(let i=0;i<targets.length;i+=25){const chunk=targets.slice(i,i+25);const j=await c('/graphql.json',{query:`mutation($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){metafields{ownerType key value} userErrors{message}}}`,variables:{metafields:chunk.map(t=>({ownerId:t.variantId,namespace:'order_manager',key:'price_review_required',type:'boolean',value:'true'}))}});const x=j.data.metafieldsSet;if(x.userErrors.length||x.metafields.length!==chunk.length||x.metafields.some(x=>x.value!=='true'))throw Error('Price hold flag update failed');}
for(const t of targets){const p=before.find(x=>x.id===t.variantId);if(!p||p.sku!==t.sku||p.inventoryPolicy!=='DENY'||!p.inventoryItem.tracked)throw Error('Unsafe inventory mapping');
 for(const level of p.inventoryItem.inventoryLevels.nodes){
  const j=await c('/inventory_levels/set.json',{location_id:Number(level.location.id.split('/').at(-1)),inventory_item_id:Number(p.inventoryItem.id.split('/').at(-1)),available:0});
  if(j.inventory_level?.available!==0)throw Error('Inventory hold not confirmed for '+t.sku);
 }
 results.push({sku:t.sku,variantId:t.variantId,priceHeld:true,available:0});fs.writeFileSync('.codex-tmp/price-hold-results.json',JSON.stringify(results,null,2));
 if(results.length%10===0||results.length===targets.length)console.log(JSON.stringify({held:results.length,total:targets.length}));
}
})().catch(e=>{console.error(e.message);process.exitCode=1});
