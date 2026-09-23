import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { deleteR2PhotoCardImage } from "@/lib/services/photoCardMatchService";

const deleteSchema = z.object({
  product_id: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  side: z.enum(["front", "back", "all"]),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const input = deleteSchema.parse(await request.json());
    const productId = input.product_id ?? input.productId;

    if (!productId) {
      return jsonError("product_id is required.", 422);
    }

    const product = await deleteR2PhotoCardImage({
      productId,
      side: input.side,
    });

    return Response.json({
      deleted: input.side,
      product,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Invalid delete input.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
