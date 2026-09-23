import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getVariationListingGroups } from "@/lib/variation-listing-products";
import { ensureVariationThumbnail } from "@/lib/variation-thumbnail-prepare";

const schema = z.object({ groupKey: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { groupKey } = schema.parse(await request.json());
    const group = (await getVariationListingGroups()).find((item) => item.key === groupKey);
    if (!group) return jsonError("묶음 후보가 변경되었습니다. 화면을 새로고침해 주세요.", 409);
    const prepared = await ensureVariationThumbnail(user.id, group);
    return Response.json({ status: "READY", ...prepared });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("묶음을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
