import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { getRegistrationPreview } from "@/lib/registration-preview";

export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    await requireApiUser();
    const params = new URL(request.url).searchParams;
    const channel = z.enum(["EBAY", "SHOPIFY"]).parse(params.get("channel"));
    const exclude = z.array(z.string().min(1).max(100)).max(40).parse(params.getAll("exclude"));
    return Response.json(await getRegistrationPreview(channel, params.get("random") === "1", exclude));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError("시험등록 대상을 불러오지 못했습니다. 다시 시도해 주세요.", 422);
  }
}
