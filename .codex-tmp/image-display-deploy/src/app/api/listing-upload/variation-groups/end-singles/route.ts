import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";

const schema=z.object({groupKeys:z.array(z.string()).min(1).max(50),confirmed:z.literal(true)});
const cell=(value:unknown)=>`"${String(value??"").replace(/"/g,'""')}"`;

export async function POST(request:Request){
 try{
  const user=await requireApiUser();const input=schema.parse(await request.json());
  const states=await prisma.variationListingState.findMany({where:{userId:user.id,groupKey:{in:input.groupKeys},ebayItemId:{not:null}}});
  const ids=[...new Set(states.flatMap(state=>Array.isArray(state.includedProductIds)?state.includedProductIds.filter((id):id is string=>typeof id==="string"):[]))];
  const products=await prisma.product.findMany({where:{id:{in:ids},ebayItemId:{not:null},listingStatus:{in:["ACTIVE","PUBLISHED","LISTED"]}},select:{sku:true,ebayItemId:true}});
  const rows=products.filter(product=>!states.some(state=>state.ebayItemId===product.ebayItemId));
  if(!rows.length)return jsonError("종료할 기존 활성 단품이 없습니다.",422);
  const body=[["*Action(SiteID=US|Country=US|Currency=USD|Version=1193)","Item number","Custom label (SKU)"],...rows.map(row=>["End",row.ebayItemId??"",row.sku])].map(row=>row.map(cell).join(",")).join("\r\n");
  return new Response(`\uFEFF${body}`,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="ebay-end-replaced-singles-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"no-store"}});
 }catch(error){if(error instanceof UnauthorizedError)return jsonError("Unauthorized",401);if(error instanceof z.ZodError)return jsonError("선택을 확인해 주세요.",422);return jsonError(asErrorMessage(error),500)}
}
