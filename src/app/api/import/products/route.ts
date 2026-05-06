import { asErrorMessage, jsonError } from "@/lib/http";
import { importProductsCsv, importProductsExcel } from "@/lib/products";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonError("CSV 또는 엑셀 파일을 선택해 주세요.", 422);
    }

    const fileName = file.name.toLowerCase();
    const result =
      fileName.endsWith(".xlsx") || fileName.endsWith(".xls")
        ? await importProductsExcel(Buffer.from(await file.arrayBuffer()), user.id)
        : await importProductsCsv(await file.text(), user.id);

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
