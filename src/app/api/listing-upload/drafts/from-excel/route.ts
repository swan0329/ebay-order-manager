import { asErrorMessage, jsonError } from "@/lib/http";
import {
  createDraftsFromRows,
  parseListingDraftRows,
} from "@/lib/services/listingDraftService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const form = await request.formData();
    const file = form.get("file");
    const templateId = String(form.get("templateId") ?? "").trim() || null;

    if (!(file instanceof File)) {
      return jsonError("엑셀 파일을 선택해 주세요.", 422);
    }

    const rows = parseListingDraftRows(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    const drafts = await createDraftsFromRows({
      userId: user.id,
      rows,
      templateId,
    });

    return Response.json({ drafts, created: drafts.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
