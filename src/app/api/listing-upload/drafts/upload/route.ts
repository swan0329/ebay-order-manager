import { z } from "zod";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { uploadDrafts } from "@/lib/services/ebayListingUploadService";
import { issueListingPreviewToken, previewListingUpload, verifyListingPreviewToken } from "@/lib/services/listingUploadSafety";

const schema=z.object({ids:z.array(z.string().min(1)).min(1).max(2),remainingLimit:z.coerce.number().int().min(0),dryRun:z.boolean().default(true),confirmed:z.boolean().default(false),previewToken:z.string().optional()});
export async function POST(request:Request){try{const user=await requireApiUser();const input=schema.parse(await request.json());const preview=await previewListingUpload(user.id,input.ids,input.remainingLimit);if(input.dryRun)return Response.json({...preview,dryRun:true,previewToken:preview.valid?issueListingPreviewToken(input.ids,input.remainingLimit):null});if(!input.confirmed||!input.previewToken||!verifyListingPreviewToken(input.previewToken,input.ids,input.remainingLimit))return jsonError("유효한 미리보기 확인이 필요합니다.",409);if(!preview.valid)return jsonError("중복 또는 검증 오류가 있어 게시할 수 없습니다.",409,preview.issues);const drafts=await prisma.listingDraft.findMany({where:{userId:user.id,id:{in:preview.ids}}});const results=await uploadDrafts(user.id,drafts.map(d=>d.id));const uploaded=results.filter(row=>"result" in row).length;return Response.json({uploaded,failed:results.length-uploaded,results});}catch(error){const unauthorized=error instanceof UnauthorizedError;return jsonError(unauthorized?"관리자 권한이 필요합니다.":error instanceof Error?error.message:"업로드하지 못했습니다.",unauthorized?401:400)}}
