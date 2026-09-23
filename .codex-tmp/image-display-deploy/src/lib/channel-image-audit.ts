import { createHash, randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { prisma } from "./prisma";
import { getListingImageSettings } from "./variation-thumbnail-settings";
import { collectListingSourceImageUrls } from "./listing-source-images";
import { listingWatermarkRenderVersion } from "./ebay-watermarked-images";
import { getChannelImageChanges } from "./channel-image-changes";
import { getValidAccessToken } from "./ebay";
import { getActiveEbayInventoryAccount } from "./services/ebayApiService";
import { getEbayConfig } from "./env";

export async function localImageAudit(userId: string) {
  const settings = await getListingImageSettings(userId);
  const rows = await prisma.$queryRaw<Array<{id:string;sku:string;imageUrl:string|null;imageSource:string|null;sourceImageUrl:string|null;userFrontImageUrl:string|null;history:string|null;ebayItemId:string|null;shopifyProductId:string|null;shopifyVariantId:string|null}>>`
    SELECT p.id,p.sku,p.image_url AS "imageUrl",p.image_source AS "imageSource",p.source_image_url AS "sourceImageUrl",p.user_front_image_url AS "userFrontImageUrl",
    p.ebay_item_id AS "ebayItemId",p.shopify_product_id AS "shopifyProductId",p.shopify_variant_id AS "shopifyVariantId",
    (SELECT h.image_url FROM product_image_history h WHERE h.product_id=p.id AND h.action IN ('lens_saved','worker_approved','ai_approved') ORDER BY h.created_at DESC LIMIT 1) AS history
    FROM products p WHERE COALESCE(p.ebay_item_id,'') <> '' OR COALESCE(p.shopify_product_id,'') <> ''`;
  const local = rows.map(p => {
    const approved = ["lens_workbench","r2_user_uploaded","user_uploaded"].includes(p.imageSource??"") || Boolean(p.userFrontImageUrl);
    let urls = approved ? collectListingSourceImageUrls({...p,ebayImageUrls:[]}) : [];
    if (!urls.length && p.history) urls = collectListingSourceImageUrls({...p,userFrontImageUrl:null,imageUrl:p.history,ebayImageUrls:[]});
    const source = urls[0]??null;
    const logo = settings.watermarkEnabled ? settings.logoKey??settings.logoUrl??"missing" : "watermark-disabled";
    const expectedHash = source ? createHash("sha256").update([listingWatermarkRenderVersion,source,logo,String(p.imageSource==='lens_workbench'),JSON.stringify(settings)].join('\0')).digest('hex') : null;
    return {id:p.id,sku:p.sku,ebayItemId:p.ebayItemId,shopifyProductId:p.shopifyProductId,shopifyVariantId:p.shopifyVariantId,source,expectedHash};
  });
  const savedGroups = await prisma.variationListingState.findMany({where:{userId,ebayItemId:{not:null}},select:{ebayItemId:true,parentSku:true,includedProductIds:true,groupKey:true}});
  const manualLinks = await prisma.ebayActiveListing.findMany({where:{reportImport:{userId},matchStatus:"MANUALLY_VERIFIED",productId:{not:null}},select:{itemId:true,productId:true,linkedAt:true},distinct:["itemId","productId"]});
  return {at:new Date(),local,savedGroups,manualLinks,pending:{EBAY:await getChannelImageChanges(userId,"EBAY"),SHOPIFY:await getChannelImageChanges(userId,"SHOPIFY")}};
}

export async function readEbayImageAudit(userId: string, itemIds?: string[]) {
  const account=await getActiveEbayInventoryAccount(userId),token=await getValidAccessToken(account);
  const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
  const call=async(name:string,body:string)=>{
    const r=await fetch(new URL('/ws/api.dll',getEbayConfig().hosts.api),{method:'POST',cache:'no-store',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'text/xml','X-EBAY-API-CALL-NAME':name,'X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1423','X-EBAY-API-IAF-TOKEN':token},body:`<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents"><MessageID>${randomUUID()}</MessageID>${body}</${name}Request>`});
    const d=parser.parse(await r.text())[`${name}Response`];
    if(!r.ok||!['Success','Warning'].includes(d?.Ack))throw Error('eBay 이미지 조회 실패');
    return d;
  };
  if(itemIds) {
    const items=[];
    for(const id of itemIds) {
      const d=await call('GetItem',`<ItemID>${id}</ItemID><DetailLevel>ReturnAll</DetailLevel>`);
      const p=d.Item;
      items.push({ItemID:p.ItemID,SKU:p.SKU,Title:p.Title,PictureDetails:p.PictureDetails,Variations:p.Variations,SellingStatus:p.SellingStatus,Quantity:p.Quantity});
    }
    return {items};
  }
  const items=[];
  for(let page=1;page<=30;page++) {
    const d=await call('GetMyeBaySelling',`<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`);
    const v=d.ActiveList?.ItemArray?.Item;
    for(const p of v===undefined?[]:Array.isArray(v)?v:[v])items.push({ItemID:p.ItemID,SKU:p.SKU,Title:p.Title,PictureDetails:p.PictureDetails,Variations:p.Variations,SellingStatus:p.SellingStatus,Quantity:p.Quantity});
    const pages=Number(d.ActiveList?.PaginationResult?.TotalNumberOfPages??0);
    if(pages>30)throw Error('eBay 전체 페이지 상한 초과');if(page>=pages)break;
  }
  return {items};
}

export async function flagImageAudit(userId:string,channel:"EBAY"|"SHOPIFY",entries:Array<{parent:string;reason:string;observedUrls:string[]}>) {
  const products=await prisma.product.findMany({where:channel==='EBAY'?{ebayItemId:{in:entries.map(e=>e.parent)}}:{shopifyProductId:{in:entries.map(e=>e.parent)}},select:{sku:true,ebayItemId:true,shopifyProductId:true}});
  if(entries.some(e=>!products.some(p=>(channel==='EBAY'?p.ebayItemId:p.shopifyProductId)===e.parent)))throw Error('연결되지 않은 상품이 포함되어 있습니다.');
  await prisma.$transaction(entries.map(entry=>prisma.syncLog.create({data:{userId,type:`CHANNEL_IMAGE_REVIEW_${channel}`,status:'SUCCESS',message:`${entry.parent}: 이미지 변동 필요 · ${entry.reason}`,rawJson:entry}})));
  return {flagged:entries.length};
}
