import { asErrorMessage, jsonError } from "@/lib/http";
import { syncFulfillmentsForOrder } from "@/lib/orders";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const result = await syncFulfillmentsForOrder(user.id, id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
