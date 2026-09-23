import fs from 'node:fs';
import {createRequire} from 'node:module';
import {holdShopifyVariantForMissingPrice} from '../src/lib/shopify-price-hold';
import {fetchPocamarketProductState,loadPocamarketApiConfig} from '../src/lib/pocamarket-api-collector';
import {resolveListingPriceUsd} from '../src/lib/listing-price';
import {listingQuantity} from '../src/lib/listing-quantity';
const require=createRequire(import.meta.url);const {read,save}=require('./incident-all-client.cjs');
(async()=>{const call=await require('./shopify-task-client.cjs').client();const config=loadPocamarketApiConfig();const products=[...read('products'),...read('products-extra')];const targets=read('shopify-comparison').filter((r:any)=>r.result==='SHOULD_HOLD');const results=[];
for(const target of targets){const p=products.find((p:any)=>p.id===target.productId);if(!p)throw Error('Missing product');const state=await fetchPocamarketProductState(p.pocamarketId,config);const now=new Date().toISOString();const current={...p,salePrice:state.isSoldOut?null:state.price,pocamarketAvailableCount:state.availableCount,pocamarketSyncedAt:now,pocamarketLastAttemptAt:now};if(resolveListingPriceUsd(current,read('settings').settings)&&listingQuantity(current)>0){console.log(p.sku,'supply changed; skipped');continue;}
const j=await call('/graphql.json',{query:'query($id:ID!){productVariant(id:$id){id sku product{id} inventoryItem{id}}}',variables:{id:target.variantId}});const v=j.data.productVariant;if(v?.sku!==p.sku||v.product.id!=='gid://shopify/Product/'+p.shopifyProductId)throw Error('Identity mismatch');const identity={sku:p.sku,shopifyProductId:p.shopifyProductId,shopifyVariantId:p.shopifyVariantId,shopifyInventoryItemId:v.inventoryItem.id.split('/').at(-1)};
await holdShopifyVariantForMissingPrice((r)=>call(r.path,r.body,r.method),identity);results.push({sku:p.sku,productId:p.id,variantId:target.variantId,verified:true,available:0,observedAt:new Date().toISOString()});save('shopify-holds',results);console.log(p.sku,'actual hold verified');}
})().catch(e=>{console.error(e.message);process.exitCode=1});
