import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { bulkProductUpdateSchema, bulkUpdateProducts } from "@/lib/products";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const input = bulkProductUpdateSchema.parse(await request.json());
    const result = await bulkUpdateProducts(input, user.id);

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("일괄 수정 입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
