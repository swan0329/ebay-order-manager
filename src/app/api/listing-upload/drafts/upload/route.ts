import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { uploadDrafts } from "@/lib/services/ebayListingUploadService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const results = await uploadDrafts(user.id, input.ids);

    return Response.json({
      results,
      uploaded: results.filter((result) => "result" in result).length,
      failed: results.filter((result) => "error" in result).length,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("업로드할 draft를 선택해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
