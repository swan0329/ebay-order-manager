import { asErrorMessage, jsonError } from "@/lib/http";
import {
  createListingTemplate,
  listListingTemplates,
} from "@/lib/services/listingTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    const user = await requireApiUser();
    const templates = await listListingTemplates(user.id);
    return Response.json({ templates });
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
    const template = await createListingTemplate(user.id, await request.json());
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
