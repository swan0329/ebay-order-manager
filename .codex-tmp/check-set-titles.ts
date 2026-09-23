import fs from 'node:fs';
import {buildEbayVariationListingTitle,clampAspectValue} from '../src/lib/ebay-listing-fields';
const data=JSON.parse(fs.readFileSync('.codex-tmp/set-title-groups.json','utf8'));
for(const g of data.groups.filter((g:any)=>g.products.some((p:any)=>['26486','103957'].includes(p.sku)))) {
 const title=buildEbayVariationListingTitle(g);
 console.log(JSON.stringify({skus:g.products.map((p:any)=>p.sku),title,length:title.length,set:clampAspectValue(g.albumName)}));
}
