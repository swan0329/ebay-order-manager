import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage,jsonError } from "@/lib/http";
import { localImageAudit,readEbayImageAudit,flagImageAudit } from "@/lib/channel-image-audit";
export const maxDuration=300;
export async function GET(request:Request) {
 try {const user=await requireApiUser();const q=new URL(request.url).searchParams;
  const ids=q.get('items')?.split(',');if(ids&&(!ids.length||ids.length>10||ids.some(id=>!/^\d{9,15}$/.test(id))))return jsonError('상품 ID를 확인해 주세요.',422);
  return Response.json(q.get('channel')==='EBAY'?await readEbayImageAudit(user.id,ids):await localImageAudit(user.id));
 }catch(e){return jsonError(e instanceof UnauthorizedError?'Unauthorized':asErrorMessage(e),e instanceof UnauthorizedError?401:500);}
}
const schema=z.object({channel:z.enum(['EBAY','SHOPIFY']),entries:z.array(z.object({parent:z.string().regex(/^\d{9,20}$/),reason:z.string().min(1).max(1000),observedUrls:z.array(z.string().url()).max(250)})).min(1).max(500)});
export async function POST(request:Request) {
 try{const user=await requireApiUser();const input=schema.parse(await request.json());return Response.json(await flagImageAudit(user.id,input.channel,input.entries));}
 catch(e){return jsonError(e instanceof UnauthorizedError?'Unauthorized':asErrorMessage(e),e instanceof UnauthorizedError?401:422);}
}
