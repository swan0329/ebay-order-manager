import { z } from "zod";
import { deleteObjectFromR2, uploadBufferToR2 } from "@/lib/r2";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getListingImageSettings, saveListingBackground } from "@/lib/variation-thumbnail-settings";

const schema = z.object({ dataUrl: z.string().max(14_000_000), fileName: z.string().max(180).optional() });
const mimeExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const match = input.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) return jsonError("PNG, JPG, WebP 배경 이미지만 저장할 수 있습니다.", 422);
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 10_000_000) return jsonError("배경 이미지는 10MB 이하만 저장할 수 있습니다.", 422);
    const previous = await getListingImageSettings(user.id);
    const uploaded = await uploadBufferToR2({
      buffer,
      key: `settings/${user.id}/listing-background-${Date.now()}.${mimeExtensions[match[1]]}`,
      contentType: match[1],
      cacheControl: "public, max-age=3600",
    });
    await saveListingBackground(user.id, uploaded.url, uploaded.key);
    if (previous.backgroundKey && previous.backgroundKey !== uploaded.key) await deleteObjectFromR2(previous.backgroundKey);
    return Response.json({ backgroundUrl: uploaded.url, backgroundKey: uploaded.key, fileName: input.fileName ?? null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("배경 이미지 파일을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
