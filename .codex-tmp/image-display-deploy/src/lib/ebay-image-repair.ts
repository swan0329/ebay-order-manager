import { getEbayVariationMembershipByProductId } from "@/lib/variation-listing-products";
import { repairInventoryImages } from "@/lib/ebay-inventory-images";
import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { prepareProductChannelImages, prepareProductListingSource } from "@/lib/listing-source-images";
import { ensureVariationThumbnail } from "@/lib/variation-thumbnail-prepare";

// Trading XML is heterogeneous (single nodes or repeated arrays). Validate
// identities and the writable picture shape explicitly at the boundary below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = Record<string, any>;
const list = <T>(v:T|T[]|undefined):T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const xml = (v:unknown) => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export function imageOnlyRevision(itemId:string, urls:string[], pictures?:Array<{name:string;value:string;urls:string[]}>) {
  const names=new Set(pictures?.map(p=>p.name));
  if(names.size>1)throw Error("옵션 이미지 기준이 여러 개라 교체를 중단했습니다.");
  return `<Item><ItemID>${xml(itemId)}</ItemID><PictureDetails>${urls.map(u=>`<PictureURL>${xml(u)}</PictureURL>`).join('')}</PictureDetails>${pictures?.length?`<Variations><Pictures><VariationSpecificName>${xml(pictures[0].name)}</VariationSpecificName>${pictures.map(p=>`<VariationSpecificPictureSet><VariationSpecificValue>${xml(p.value)}</VariationSpecificValue>${p.urls.map(u=>`<PictureURL>${xml(u)}</PictureURL>`).join('')}</VariationSpecificPictureSet>`).join('')}</Pictures></Variations>`:''}</Item>`;
}
function invariant(item:Node) {
  return JSON.stringify({id:item.ItemID,title:item.Title,price:item.SellingStatus?.CurrentPrice,quantity:item.Quantity,status:item.SellingStatus?.ListingStatus,
    variants:list<Node>(item.Variations?.Variation).map(v=>({sku:v.SKU,price:v.StartPrice,quantity:v.Quantity,specifics:v.VariationSpecifics})).sort((a,b)=>String(a.sku).localeCompare(String(b.sku)))});
}
export async function getEbayImageRepairTargets(userId:string) {
  const account=await getActiveEbayInventoryAccount(userId),token=await getValidAccessToken(account);
  const items:Node[]=[];
  for(let page=1;page<=30;page++) {
    const response=await fetch(new URL('/ws/api.dll',getEbayConfig().hosts.api),{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'text/xml','X-EBAY-API-CALL-NAME':'GetMyeBaySelling','X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1423','X-EBAY-API-IAF-TOKEN':token},body:`<?xml version="1.0" encoding="UTF-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`});
    const data=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(await response.text()).GetMyeBaySellingResponse;
    if(!response.ok||!['Success','Warning'].includes(data?.Ack))throw Error('eBay 현재 판매 목록 조회 실패');
    items.push(...list<Node>(data.ActiveList?.ItemArray?.Item));
    const pages=Number(data.ActiveList?.PaginationResult?.TotalNumberOfPages??0);
    if(pages>30)throw Error('전체 판매 목록 페이지 상한 초과');
    if(page>=pages)break;
  }
  const products=await prisma.product.findMany({where:{ebayItemId:{in:items.map(i=>i.ItemID)}},select:{id:true,sku:true,ebayItemId:true}});
  return items.map(i=>({itemId:i.ItemID,title:i.Title,sku:i.SKU??null,productId:products.find(p=>p.ebayItemId===i.ItemID)?.id??null,variants:list<Node>(i.Variations?.Variation).length}));
}
export async function repairEbayImages(userId:string,productId:string) {
  const product=await prisma.product.findUnique({where:{id:productId}});
  if(!product)throw Error("내부 상품을 찾을 수 없습니다.");
  const itemId=(await getEbayVariationMembershipByProductId(userId)).get(productId) ?? product.ebayItemId;
  if(!itemId)throw Error("연결된 eBay 상품이 없습니다.");
  const account=await getActiveEbayInventoryAccount(userId), token=await getValidAccessToken(account);
  const call=async(name:string,fields:string):Promise<Node>=>{
    const response=await fetch(new URL('/ws/api.dll',getEbayConfig().hosts.api),{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'text/xml','X-EBAY-API-CALL-NAME':name,'X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1423','X-EBAY-API-IAF-TOKEN':token},body:`<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${fields}</${name}Request>`});
    const data=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(await response.text())[`${name}Response`];
    if(!response.ok||!['Success','Warning'].includes(data?.Ack))throw Error(`eBay 이미지 수정: ${list<Node>(data?.Errors).map(e=>`${e.ErrorCode}: ${e.LongMessage||e.ShortMessage}`).join('; ')||response.status}`);
    return data;
  };
  const read=async()=> (await call('GetItem',`<ItemID>${xml(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`)).Item as Node;
  const before=await read();
  if(before.ItemID!==itemId)throw Error("eBay 판매 상품 연결이 일치하지 않습니다.");
  if (["Completed", "Ended"].includes(before.SellingStatus?.ListingStatus)) return { listingId: itemId, verified: false, skipped: true, reason: "종료된 eBay 판매상품 · 이미지 변경 제외" };
  if(before.SellingStatus?.ListingStatus!=='Active')throw Error("활성 판매 상품 연결을 확인하지 못했습니다.");
  const variants=list<Node>(before.Variations?.Variation);
  const products=variants.length?await prisma.product.findMany({where:{sku:{in:variants.map(v=>String(v.SKU))}}}):[product];
  if(variants.length && (products.length!==variants.length||!products.some(p=>p.id===productId)))throw Error("전체 옵션의 상품 연결이 일치하지 않습니다.");
  if(!variants.length&&before.SKU&&before.SKU!==product.sku)throw Error("판매 상품 SKU가 일치하지 않습니다.");
  const sources=await Promise.all(products.map(prepareProductListingSource));
  const prepared=await Promise.all(products.map(p=>prepareProductChannelImages(userId,p)));
  let urls=prepared[0].ebayImageUrls;
  let pictures:Array<{name:string;value:string;urls:string[]}>|undefined;
  if(variants.length){
    const thumbnail=await ensureVariationThumbnail(userId,{key:`ebay-images:${itemId}`,groupName:product.brand??'',albumName:product.category??'',versionName:'',title:before.Title,products:sources.map(p=>({...p,variationName:p.optionName??p.sku}))});
    urls=[thumbnail.url];
    pictures=variants.map(v=>{
      const specifics=list<Node>(v.VariationSpecifics?.NameValueList);
      if(specifics.length!==1||list(specifics[0].Value).length!==1)throw Error("단일 기준 옵션만 이미지 교체할 수 있습니다.");
      return {name:String(specifics[0].Name),value:String(specifics[0].Value),urls:prepared.find(p=>p.sku===v.SKU)!.ebayImageUrls};
    });
  }
  // Rendering can take time. Refuse to write if sales or another edit changed
  // the target in that interval. Never send price/quantity/offer fields.
  if(invariant(await read())!==invariant(before))throw Error("이미지 준비 중 판매 정보가 변경됐습니다. 다시 실행해 주세요.");
  const log=await prisma.syncLog.create({data:{userId,type:'EBAY_IMAGE_REPAIR',status:'PARTIAL',message:`${itemId}: 이미지 변경 전 스냅샷`,rawJson:JSON.parse(JSON.stringify({before,urls,pictures}))}});
  const state = variants.length ? await prisma.variationListingState.findFirst({ where: { userId, ebayItemId: itemId }, select: { parentSku: true } }) : null;
  const inventory = await repairInventoryImages(account, itemId, prepared.map(p => ({ sku: p.sku, urls: p.ebayImageUrls })), urls, variants.length ? state?.parentSku ?? before.SKU : undefined);
  if (!inventory) await call('ReviseFixedPriceItem',imageOnlyRevision(itemId,urls,pictures));
  const after=await read();
  if(invariant(before)!==invariant(after))throw Error("이미지 수정 후 가격·수량·옵션 대조가 일치하지 않습니다. 재확인이 필요합니다.");
  const parent=list<string>(after.PictureDetails?.PictureURL);
  const external=list<Node>(after.PictureDetails?.ExtendedPictureDetails).map(p=>p.ExternalPictureURL);
  const parentVerified=urls.every(u=>parent.includes(u)||external.includes(u));
  const remoteSets=list<Node>(after.Variations?.Pictures).flatMap(p=>list<Node>(p.VariationSpecificPictureSet));
  const optionVerified=!pictures||pictures.every(p=>remoteSets.some(s=>s.VariationSpecificValue===p.value&&p.urls.every(u=>list(s.PictureURL).includes(u)||list<Node>(s.ExtendedPictureDetails).some(e=>e.ExternalPictureURL===u))));
  await prisma.syncLog.update({where:{id:log.id},data:{status:parentVerified&&optionVerified?'SUCCESS':'PARTIAL',message:`${itemId}: 이미지 변경 후 검증 ${parentVerified&&optionVerified?'완료':'필요'}`,rawJson:JSON.parse(JSON.stringify({before,after,urls,pictures,parentVerified,optionVerified}))}});
  if(!parentVerified||!optionVerified)throw Error("이미지 변경 응답은 성공했으나 eBay 이미지 원본 URL 재조회 확인이 필요합니다.");
  return {listingId:itemId,verified:true};
}
