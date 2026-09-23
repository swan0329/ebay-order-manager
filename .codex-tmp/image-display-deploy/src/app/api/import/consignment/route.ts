import { consignmentImportSchema, importConsignmentRows, verifyConsignmentImport } from "@/lib/consignment-import";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const params = new URL(request.url).searchParams;
    const brand = params.get("brand")?.trim();
    const source = params.get("source")?.trim();
    if (!brand || brand.length > 120 || !source || source.length > 240) {
      return Response.json({ error: "그룹과 원본 파일명을 확인해 주세요." }, { status: 422 });
    }
    return Response.json(await verifyConsignmentImport(brand, source));
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json({ error: "가져오기 결과를 확인하지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = consignmentImportSchema.safeParse(await request.json());
    if (!input.success) return Response.json({ error: "위탁 상품대장 입력값을 확인해 주세요." }, { status: 422 });
    return Response.json(await importConsignmentRows(input.data, user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json({ error: "위탁 상품대장을 등록하지 못했습니다. 입력값과 중복 상품번호를 확인해 주세요." }, { status: 422 });
  }
}
