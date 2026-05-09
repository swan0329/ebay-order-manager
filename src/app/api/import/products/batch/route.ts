import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { importProductsRows } from "@/lib/products";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const importBatchSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(250),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = importBatchSchema.parse(await request.json());
    const result = await importProductsRows(input.rows, user.id);

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("상품 import 배치 값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
