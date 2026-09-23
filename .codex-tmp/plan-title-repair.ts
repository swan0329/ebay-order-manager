import fs from 'node:fs';
import {buildEbayVariationListingTitle} from '../src/lib/ebay-listing-fields';
import {variationVersionName} from '../src/lib/variation-listing-groups';
import {listingAlbumContext} from '../src/lib/listing-title-context';
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const local=[...read('.codex-tmp/price-repair-local-products.json'),...read('.codex-tmp/title-repair-muster-local.json').products];
const products=read('.codex-tmp/title-repair-before.json').data.products.nodes;
const plan=[];
for(const p of products.filter((p:any)=>p.status==='ACTIVE'&&p.variants.nodes.length>1)){
 const rows=p.variants.nodes.map((v:any)=>local.find((x:any)=>x.shopifyProductId===p.id.split('/').at(-1)&&x.shopifyVariantId===v.id.split('/').at(-1)&&x.sku===v.sku));
 if(rows.some((x:any)=>!x))continue;
 const first=rows[0],version=variationVersionName(first);
 const combined=[first.category,version].filter(Boolean).join(' ');
 const corrected=listingAlbumContext(first.brand,first.category,version);
 const tokens=p.title.toLowerCase().split(/\s+/);let repeated=false;
 for(let size=3;size<=Math.floor(tokens.length/2);size++)for(let i=0;i<=tokens.length-size;i++){
  const phrase=tokens.slice(i,i+size).join(' ');if(tokens.slice(i+size).join(' ').includes(phrase))repeated=true;
 }
 if(combined===corrected||!repeated)continue;
 const title=buildEbayVariationListingTitle({groupName:first.brand,albumName:first.category,versionName:version,products:rows});
 if(title!==p.title)plan.push({id:p.id,before:p.title,title,skus:p.variants.nodes.map((v:any)=>v.sku),handle:p.handle});
}
fs.writeFileSync('.codex-tmp/title-repair-plan.json',JSON.stringify(plan,null,2));console.log(JSON.stringify(plan));
