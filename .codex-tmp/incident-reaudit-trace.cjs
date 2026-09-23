const fs=require('fs');const {save}=require('./incident-all-client.cjs');const skus=new Set(['296333','284272','284806','287832']);const found=[];
for(const name of fs.readdirSync('.codex-tmp').filter(n=>/^(procurement|order-four|incident-all-operations).*\.json$/.test(n))){
 let root;try{root=JSON.parse(fs.readFileSync('.codex-tmp/'+name,'utf8'))}catch{continue}
 function walk(v,parent){if(!v||typeof v!=='object')return;
  if(skus.has(v.sku)&&('price' in v||'cost' in v)){found.push({file:name,sku:v.sku,price:v.price,cost:v.cost,itemId:v.itemId,jobId:parent?.id,status:parent?.status,submittedAt:parent?.submittedAt,completedAt:parent?.completedAt});}
  for(const child of Object.values(v)){if(Array.isArray(child)){for(const row of child)walk(row,v)}else if(child&&typeof child==='object')walk(child,v)}
 }walk(root,null);
}save('reaudit-price-trace',found);console.log(JSON.stringify(found));
