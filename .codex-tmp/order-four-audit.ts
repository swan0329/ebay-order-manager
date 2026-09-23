import fs from 'node:fs';
import {parseEnv} from 'node:util';
Object.assign(process.env,parseEnv(fs.readFileSync('.env','utf8')));
async function main() {
 const {prisma:p}=await import('../src/lib/prisma');
 const skus=['296333','284272','284806','287832'];
 try {
 const products=await p.product.findMany({where:{sku:{in:skus}},select:{id:true,sku:true,pocamarketId:true,salePrice:true,costPrice:true,stockQuantity:true,isSoldOut:true,pocamarketAvailableCount:true,pocamarketSyncedAt:true,pocamarketLastAttemptAt:true,ebayPrice:true,finalListingPriceUsd:true,ebayLastSyncedPrice:true,shopifyLastSyncedPrice:true,imageUrl:true,sourceImageUrl:true,userImageRegistered:true,imageSource:true,ebayItemId:true,shopifyVariantId:true}});
 const orders=await p.order.findMany({where:{items:{some:{sku:{in:skus}}}},orderBy:{orderDate:'desc'},take:8,select:{id:true,orderNumber:true,salesChannel:true,totalAmount:true,currency:true,orderDate:true,rawJson:true,items:{select:{id:true,sku:true,quantity:true,rawJson:true,productId:true}}}});
 const safeOrders=orders.map(({rawJson,...order})=>{const r=rawJson as any;return {...order,pricingSummary:r.pricingSummary,totalPriceSet:r.totalPriceSet,items:order.items.map(({rawJson,...item})=>{const r=rawJson as any;return {...item,rawKeys:Object.keys(r??{}),lineItemCost:r?.lineItemCost,lineItemTotal:r?.lineItemTotal,discountedTotalSet:r?.discountedTotalSet,originalUnitPriceSet:r?.originalUnitPriceSet,discounts:r?.appliedPromotions,soldImageUrl:r?.soldImageUrl,image:r?.image}})}});
 const settings=await p.pricingSettings.findFirst();
 const result={observedAt:new Date().toISOString(),products,orders:safeOrders,settings:settings?Object.fromEntries(Object.entries(settings).filter(([k])=>!/id|created|updated/i.test(k))):null};
 fs.writeFileSync('.codex-tmp/order-four-audit.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
 }finally{await p.$disconnect()}
}
main().catch(e=>{console.error('Audit failed',e.name,e.code);process.exitCode=1});

