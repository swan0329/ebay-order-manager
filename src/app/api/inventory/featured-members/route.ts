import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { setProductFeaturedMembers } from "@/lib/services/photoCardMatchService";

const schema = z.object({
  productId: z.string().min(1),
  members: z.array(z.string()).max(50),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse(await request.json());
    const featuredMembers = await setProductFeaturedMembers(
      input.productId,
      input.members,
    );
    return Response.json({ ok: true, featuredMembers });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
