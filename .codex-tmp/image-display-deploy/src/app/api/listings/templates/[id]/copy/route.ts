import { asErrorMessage, jsonError } from "@/lib/http";
import { copyListingTemplate } from "@/lib/services/listingTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const template = await copyListingTemplate(user.id, id);
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
