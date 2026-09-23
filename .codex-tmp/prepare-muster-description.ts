import fs from 'node:fs';
import {loadEnvConfig} from '@next/env';
import {variationVersionName} from '../src/lib/variation-listing-groups';
loadEnvConfig(process.cwd());
async function main(){
 const {buildShopifyVariationBodyHtml}=await import('../src/lib/services/shopifyService');
 const all=JSON.parse(fs.readFileSync('.codex-tmp/title-repair-muster-local.json','utf8')).products;
 const rows=all.filter((p:any)=>p.shopifyProductId==='15266943533424');
 const first=rows.find((p:any)=>p.sku==='29873');
 const descriptionHtml=buildShopifyVariationBodyHtml({key:'saved-existing',groupName:'BTS',albumName:first.category,
   versionName:variationVersionName(first),title:'BTS Official 3RD MUSTER ARMY.ZIP+ DVD Photocard Kpop',
   products:rows.map((p:any)=>({...p,variationName:p.optionName}))});
 fs.writeFileSync('.codex-tmp/title-repair-description-input.json',JSON.stringify({id:'gid://shopify/Product/15266943533424',descriptionHtml},null,2));
 console.log(descriptionHtml);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
