import { z } from "zod";
import { getEbayImageRepairTargets, repairEbayImages } from "@/lib/ebay-image-repair";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
export const maxDuration=300;
export async function GET(){
  try { const user=await requireApiUser(); return Response.json({items:await getEbayImageRepairTargets(user.id)}); }
  catch(error){return jsonError(error instanceof UnauthorizedError?'Unauthorized':asErrorMessage(error),error instanceof UnauthorizedError?401:500);}
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { productId } = z.object({ productId: z.string().min(1) }).parse(await request.json());
    return Response.json(await repairEbayImages(user.id, productId));
  } catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : asErrorMessage(error), error instanceof UnauthorizedError ? 401 : 422); }
}
