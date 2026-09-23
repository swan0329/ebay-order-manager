import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { bulkUpdateDrafts } from "@/lib/services/listingDraftService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1),
}).passthrough();

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const drafts = await bulkUpdateDrafts(user.id, input);
    return Response.json({ drafts, updated: drafts.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("수정할 draft를 선택해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
