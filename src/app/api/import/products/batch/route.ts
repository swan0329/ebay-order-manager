import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { importProductsRowsFast } from "@/lib/products";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const importBatchSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = importBatchSchema.parse(await request.json());
    const result = await importProductsRowsFast(input.rows);

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
