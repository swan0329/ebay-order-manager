import { z } from "zod";
import {
  createInventoryMovement,
  inventoryMovementSchema,
} from "@/lib/inventory";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = inventoryMovementSchema.parse(await request.json());
    const movement = await createInventoryMovement({
      ...input,
      createdBy: user.id,
    });

    return Response.json({ movement }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("재고 입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
