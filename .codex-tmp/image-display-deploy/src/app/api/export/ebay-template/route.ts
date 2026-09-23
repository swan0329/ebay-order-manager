import { asErrorMessage, jsonError } from "@/lib/http";
import {
  deleteEbayFileTemplate,
  getEbayFileTemplate,
  parseEbayTemplateCsv,
  saveEbayFileTemplate,
} from "@/lib/services/ebayFileTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    const user = await requireApiUser();
    const template = await getEbayFileTemplate(user.id);

    return Response.json({
      ok: true,
      template: template
        ? { columns: template.columns, columnCount: template.columns.length }
        : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return jsonError("파일이 없습니다.", 422);
    }

    const buffer = await file.arrayBuffer();
    const template = parseEbayTemplateCsv(buffer);

    await saveEbayFileTemplate(user.id, template);

    return Response.json({
      ok: true,
      columnCount: template.columns.length,
      columns: template.columns,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE() {
  try {
    const user = await requireApiUser();
    await deleteEbayFileTemplate(user.id);

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
