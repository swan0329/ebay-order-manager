import { jsonError } from "@/lib/http";
import { requireApiUser,UnauthorizedError } from "@/lib/session";
import { uploadShopifyProduct } from "@/lib/services/shopifyProductUpload";
import { ShopifyApiError } from "@/lib/services/shopifyService";
type RouteContext={params:Promise<{id:string}>};
export async function POST(_request:Request,context:RouteContext){const {id}=await context.params;try{await requireApiUser();return Response.json({ok:true,shopify:await uploadShopifyProduct(id)})}catch(error){if(error instanceof UnauthorizedError)return jsonError("Unauthorized",401);if(error instanceof ShopifyApiError)return jsonError(`Shopify 업로드 실패 (HTTP ${error.status})`,error.status>=400&&error.status<500?error.status:502);return jsonError(error instanceof Error?error.message:"Shopify 업로드 실패",500)}}
