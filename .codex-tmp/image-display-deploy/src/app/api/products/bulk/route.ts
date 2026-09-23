import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import {
  bulkDeleteProducts,
  bulkProductDeleteSchema,
  bulkProductUpdateSchema,
  bulkUpdateProducts,
} from "@/lib/products";
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
      return jsonError("Invalid bulk update input.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApiUser();
    const input = bulkProductDeleteSchema.parse(await request.json());
    const result = await bulkDeleteProducts(input);

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Invalid bulk delete input.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
