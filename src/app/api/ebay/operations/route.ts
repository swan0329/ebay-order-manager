import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getEbayOperations, getShopifyOperations } from "@/lib/services/ebayOperations";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";
import { issueListingPreviewToken, previewListingUpload, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";
import { uploadShopifyProduct } from "@/lib/services/shopifyProductUpload";
import { uploadShopifyVariationGroup } from "@/lib/services/shopifyVariationUpload";
import { repairShopifyProductImages } from "@/lib/services/shopifyImageRepair";

const executeSchema = z.object({
  action: z.enum(["CREATE", "CHANGE", "UNAVAILABLE", "REVIEW", "IMAGE_REPAIR"]),
  productIds: z.array(z.string().min(1)).min(1).max(200),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().default(false),
  previewToken: z.string().optional(),
  channel: z.enum(["EBAY","SHOPIFY"]).default("EBAY"),
});

export const maxDuration = 300;

export async function GET(request:Request) {
  try {
    const user = await requireApiUser();
    return Response.json(new URL(request.url).searchParams.get("channel")==="SHOPIFY"?await getShopifyOperations(user.id):await getEbayOperations(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = executeSchema.parse(await request.json());
    if(input.channel==="SHOPIFY"){
      const current=await getShopifyOperations(user.id);const source=input.action==="CREATE"?current.create:input.action==="CHANGE"?current.change:input.action==="UNAVAILABLE"?current.unavailable:input.action==="IMAGE_REPAIR"?current.imageRepair:current.review;const allowed=new Set(source.filter(row=>(row as { actionable?: boolean }).actionable !== false).map(row=>String(row.productId)));const productIds=[...new Set(input.productIds)];if(productIds.some(id=>!allowed.has(id)))return jsonError(input.action==="IMAGE_REPAIR"?"최종 승인 이미지가 없거나 Shopify 연결이 불완전한 항목이 포함되어 있습니다.":"포카마켓 재고가 확인되지 않았거나 현재 Shopify 전송 대상이 아닌 항목이 포함되어 있습니다.",409);
      if(input.dryRun)return Response.json({dryRun:true,planned:productIds.length,rows:source.filter(row=>productIds.includes(String(row.productId))),previewToken:issueListingPreviewToken(productIds)});
      if(!input.confirmed||!input.previewToken||!verifyListingPreviewToken(input.previewToken,productIds))return jsonError("유효한 Shopify 미리보기 후 최종 확인이 필요합니다.",409);
      const selectedRows=source.filter(row=>productIds.includes(String(row.productId)));const results=[];for(const row of selectedRows){try{const memberIds=("productIds" in row&&Array.isArray(row.productIds)?row.productIds:[row.productId]).filter((id):id is string=>typeof id==="string");const result=input.action==="IMAGE_REPAIR"?await repairShopifyProductImages(memberIds,user.id):memberIds.length>1?await uploadShopifyVariationGroup(memberIds,user.id):await uploadShopifyProduct(memberIds[0],user.id);const partialFailures="failed" in result&&Array.isArray(result.failed)?result.failed:[];results.push(partialFailures.length?{productId:String(row.productId),result,error:partialFailures.map((failure:{sku:string;reason:string})=>`${failure.sku}: ${failure.reason}`).join(" / ")}:{productId:String(row.productId),result})}catch(error){results.push({productId:String(row.productId),error:error instanceof Error?error.message:"Shopify 전송 실패"})}}
      // 브라우저 작업 콘솔이 성공·실패를 정확히 재시작할 수 있도록 실패 건수와
      // 항목별 결과를 함께 준다. 배열 자체를 failed 값으로 보내면 0건 판정이 틀어진다.
      return Response.json({succeeded:results.filter(row=>"result" in row).length,failed:results.filter(row=>"error" in row).length,results});
    }
    if (input.action === "CREATE") {
      if (!input.dryRun) return jsonError("신규등록 실행은 서명된 신규등록 경로를 사용해 주세요.", 409);
      const current = await getEbayOperations(user.id);
      const allowed = new Map(current.create.flatMap(row => row.productId ? [[row.productId, row.id] as const] : []));
      const productIds = [...new Set(input.productIds)];
      if (productIds.some(id => !allowed.has(id))) return jsonError("현재 eBay 필수 검증을 통과한 등록 초안이 아닌 항목이 포함되어 있습니다.", 409);
      const draftIds = productIds.map(id => allowed.get(id)!);
      const preview = await previewListingUpload(user.id, draftIds);
      return Response.json({ ...preview, dryRun: true, previewToken: preview.valid ? issueListingPreviewToken(draftIds) : null });
    }
    if (!input.dryRun && (!input.confirmed || !input.previewToken || !verifyListingPreviewToken(input.previewToken, input.productIds))) return jsonError("유효한 미리보기 후 최종 확인이 필요합니다.", 409);
    const current = await getEbayOperations(user.id);
    const source = input.action === "CHANGE" ? current.change : input.action === "UNAVAILABLE" ? current.unavailable : current.review;
    const allowed = new Set(source.filter((row) => row.actionable !== false).map((row) => row.productId));
    const productIds = [...new Set(input.productIds)].filter((id) => allowed.has(id));
    if (productIds.length !== new Set(input.productIds).size) return jsonError("현재 대상이 아닌 상품이 포함되어 있습니다. 목록을 새로고침해 주세요.", 409);
    const result = await pushEbayInventory({ userId: user.id, productIds, dryRun: input.dryRun, limit: 200 });
    return Response.json(input.dryRun ? { ...result, previewToken: issueListingPreviewToken(productIds) } : result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("선택 항목을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
