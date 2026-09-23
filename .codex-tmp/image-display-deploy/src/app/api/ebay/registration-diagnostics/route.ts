import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getVariationListingGroups } from "@/lib/variation-listing-products";
import { variationParentSku } from "@/lib/variation-listing-groups";
import { getActiveEbayInventoryAccount, ebayApiRequest } from "@/lib/services/ebayApiService";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const sku = z.string().min(1).max(100).regex(/^[\w-]+$/).parse(new URL(request.url).searchParams.get("sku"));
    const group = (await getVariationListingGroups()).find(g=>g.products.some(p=>p.sku===sku));
    if (!group) return jsonError("묶음 상품을 찾을 수 없습니다.",404);
    const account = await getActiveEbayInventoryAccount(user.id);
    const read = async (path: string) => { try { return (await ebayApiRequest(account,{path})).body; } catch(e) { if(e instanceof EbayApiError) return {status:e.status,error:e.body}; throw e; } };
    const remoteGroup = await read(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(variationParentSku(group.key))}`);
    const items=[];
    for(const p of group.products.slice(0,40)) items.push({sku:p.sku,inventory:await read(`/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`)});
    const state=await prisma.variationListingState.findUnique({where:{userId_groupKey:{userId:user.id,groupKey:group.key}},select:{ebayItemId:true,includedProductIds:true,parentSku:true}});
    return Response.json({groupKey:group.key,state,remoteGroup,items,truncated:group.products.length>40});
  } catch(e) { return jsonError(e instanceof UnauthorizedError?"Unauthorized":asErrorMessage(e),e instanceof UnauthorizedError?401:422); }
}
