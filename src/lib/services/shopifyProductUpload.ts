import "server-only";
import type { ProductImageExtras } from "@/lib/ebay-listing-fields";
import { prisma } from "@/lib/prisma";
import { reservedByProduct } from "@/lib/stock-reservation";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { uploadProductToShopify } from "@/lib/services/shopifyService";
import { upsertProductListing } from "@/lib/services/productListingService";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";
import { createWatermarkedListingImage, resolveListingWatermark } from "@/lib/listing-watermark";

export async function uploadShopifyProduct(productId:string,userId:string){
 const product=await prisma.product.findUnique({where:{id:productId}});if(!product)throw new Error("상품을 찾을 수 없습니다.");
 const readyImage=(await getVariationListingReadyImages()).find(row=>row.id===productId);if(!product.shopifyProductId&&!readyImage)throw new Error("최종 승인 이미지가 없어 Shopify에 신규등록할 수 없습니다.");
 const watermark=await resolveListingWatermark(userId);const salesImage=readyImage?await createWatermarkedListingImage(readyImage.listingImageUrl,watermark):null;
 const listingProduct=salesImage?{...product,imageUrl:salesImage.url,ebayImageUrls:[]}:product;
 let extras:ProductImageExtras|undefined;try{const rows=await prisma.$queryRaw<Array<{featuredMembers:string|null}>>`SELECT "featured_members" AS "featuredMembers" FROM "products" WHERE "id"=${productId} LIMIT 1`;extras=rows[0]??undefined}catch{extras=undefined}
 const lines=await prisma.orderItem.findMany({where:{productId,stockDeducted:false},select:{productId:true,quantity:true,stockDeducted:true,order:{select:{orderStatus:true,fulfillmentStatus:true}}}});const cancelled=["CANCELLED","CANCELED","CANCELLED_BY_SELLER"];
 const reserved=reservedByProduct(lines.map(line=>({productId:line.productId as string,quantity:line.quantity,stockDeducted:line.stockDeducted,orderCancelled:cancelled.includes(line.order.orderStatus)||cancelled.includes(line.order.fulfillmentStatus)}))).get(productId)??0;
 const availability=resolveChannelAvailability({status:product.status,stockQuantity:product.stockQuantity,reservedQuantity:reserved,isSoldOut:product.isSoldOut,pocamarketAvailableCount:product.pocamarketAvailableCount,pocamarketSyncedAt:product.pocamarketSyncedAt});
 if(!availability.actionable)throw new Error("포카마켓 재고가 확인되지 않아 Shopify 등록/수정을 시작하지 않습니다.");
 const settings=await prisma.pricingSettings.findUnique({where:{id:"default"}});if(!settings)throw new Error("가격 설정을 먼저 저장해 주세요.");const priceUsd=resolveListingPriceUsd(product,settings)?.priceUsd.toString();if(!priceUsd)throw new Error("USD 판매가를 계산할 수 없어 Shopify 등록/수정을 시작하지 않습니다.");
 const result=await uploadProductToShopify(listingProduct,extras,reserved,priceUsd);
 await prisma.product.update({where:{id:productId},data:{shopifyProductId:result.productId,shopifyVariantId:result.variantId,shopifyInventoryItemId:result.inventoryItemId,shopifyStatus:result.status,shopifyLastUploadedAt:new Date(),shopifyUploadError:result.inventoryError??result.imageError}});
 await upsertProductListing({productId,channel:"SHOPIFY",externalId:result.productId,price:priceUsd,quantity:result.inventorySynced?availability.quantity:null,status:result.status,metadata:{variantId:result.variantId,inventoryItemId:result.inventoryItemId,source:"shopify_upload",inventorySynced:result.inventorySynced,inventoryError:result.inventoryError,imageSync:{status:result.imageError?"FAILED":"READY",sourceImageUrl:readyImage?.listingImageUrl??product.imageUrl,salesImageUrl:salesImage?.url??product.imageUrl,watermarkSignature:watermark.signature,watermarkApplied:salesImage?.applied??false},imageError:result.imageError}});
 return result;
}
