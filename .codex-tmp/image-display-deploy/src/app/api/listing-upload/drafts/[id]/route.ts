import { asErrorMessage, jsonError } from "@/lib/http";
import { updateDraft } from "@/lib/services/listingDraftService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const draft = await updateDraft(user.id, id, await request.json());
    return Response.json({ draft });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
