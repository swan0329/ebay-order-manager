const fs=require('fs');
(async()=>{const c=await require('./shopify-task-client.cjs').client();const results=[];
for(const key of ['snippets/photocard-variant-cards.liquid','snippets/price.liquid','blocks/buy-buttons.liquid']){
 const before=fs.readFileSync('.codex-tmp/price-theme-'+key.replaceAll('/','-'),'utf8');
 const value=fs.readFileSync('shopify-theme/'+key,'utf8');
 const current=(await c('/themes/191485935984/assets.json?asset[key]='+encodeURIComponent(key))).asset.value;
 if(current===value){results.push({key,alreadyApplied:true});continue;}
 if(current!==before)throw Error('Theme changed since backup: '+key);
 await c('/themes/191485935984/assets.json',{asset:{key,value}},'PUT');
 let actual='';
 for(let attempt=0;attempt<8;attempt++){
   actual=(await c('/themes/191485935984/assets.json?asset[key]='+encodeURIComponent(key))).asset.value;
   if(actual===value)break;
   await new Promise(r=>setTimeout(r,1000));
 }
 if(actual!==value)throw Error('Theme verification failed: '+key);
 results.push({key,verified:true});fs.writeFileSync('.codex-tmp/price-theme-apply-results.json',JSON.stringify(results,null,2));
}console.log(JSON.stringify(results));})().catch(e=>{console.error(e.message);process.exitCode=1});
