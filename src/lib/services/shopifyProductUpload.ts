import "server-only";
import type { ProductImageExtras } from "@/lib/ebay-listing-fields";
import { prisma } from "@/lib/prisma";
import { reservedByProduct } from "@/lib/stock-reservation";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { uploadProductToShopify } from "@/lib/services/shopifyService";
import { upsertProductListing } from "@/lib/services/productListingService";

export async function uploadShopifyProduct(productId:string){
 const product=await prisma.product.findUnique({where:{id:productId}});if(!product)throw new Error("상품을 찾을 수 없습니다.");
 let extras:ProductImageExtras|undefined;try{const rows=await prisma.$queryRaw<Array<{featuredMembers:string|null}>>`SELECT "featured_members" AS "featuredMembers" FROM "products" WHERE "id"=${productId} LIMIT 1`;extras=rows[0]??undefined}catch{extras=undefined}
 const lines=await prisma.orderItem.findMany({where:{productId,stockDeducted:false},select:{productId:true,quantity:true,stockDeducted:true,order:{select:{orderStatus:true,fulfillmentStatus:true}}}});const cancelled=["CANCELLED","CANCELED","CANCELLED_BY_SELLER"];
 const reserved=reservedByProduct(lines.map(line=>({productId:line.productId as string,quantity:line.quantity,stockDeducted:line.stockDeducted,orderCancelled:cancelled.includes(line.order.orderStatus)||cancelled.includes(line.order.fulfillmentStatus)}))).get(productId)??0;
 const settings=await prisma.pricingSettings.findUnique({where:{id:"default"}});const priceUsd=settings?resolveListingPriceUsd(product,settings)?.priceUsd.toString():undefined;
 const result=await uploadProductToShopify(product,extras,reserved,priceUsd);
 await prisma.product.update({where:{id:productId},data:{shopifyProductId:result.productId,shopifyVariantId:result.variantId,shopifyInventoryItemId:result.inventoryItemId,shopifyStatus:result.status,shopifyLastUploadedAt:new Date(),shopifyUploadError:null}});
 await upsertProductListing({productId,channel:"SHOPIFY",externalId:result.productId,price:priceUsd??product.ebayPrice,quantity:Math.max(product.stockQuantity-product.safetyStock-reserved,0),status:result.status,metadata:{variantId:result.variantId,inventoryItemId:result.inventoryItemId,source:"shopify_upload"}});
 return result;
}
