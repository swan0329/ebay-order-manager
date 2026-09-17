import { approvedPhotoImportSchema, approvedPhotoSnapshot, importApprovedPhotos } from "@/lib/approved-photo-import";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
export const maxDuration = 30;
export async function GET() {
  try {
    await requireApiUser();
    return Response.json(await approvedPhotoSnapshot());
  } catch (error) {
    return Response.json({ error: "사진 연결 상태를 조회하지 못했습니다." }, { status: error instanceof UnauthorizedError ? 401 : 500 });
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const parsed = approvedPhotoImportSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "사진 연결 입력값을 확인해 주세요." }, { status: 422 });
    return Response.json(await importApprovedPhotos(parsed.data, user.id));
  } catch (error) {
    return Response.json({ error: "사진을 연결하지 못했습니다. 상품번호, 현재 이미지 또는 진행 중인 AI 작업을 확인해 주세요." }, { status: error instanceof UnauthorizedError ? 401 : 409 });
  }
}
