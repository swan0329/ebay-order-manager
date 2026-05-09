import { asErrorMessage, jsonError } from "@/lib/http";
import {
  deleteListingTemplate,
  updateListingTemplate,
} from "@/lib/services/listingTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const template = await updateListingTemplate(user.id, id, await request.json());
    return Response.json({ template });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const template = await deleteListingTemplate(user.id, id);
    return Response.json({ template });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
