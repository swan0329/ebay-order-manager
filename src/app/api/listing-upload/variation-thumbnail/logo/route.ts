import { z } from "zod";
import { deleteObjectFromR2, uploadBufferToR2 } from "@/lib/r2";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  getListingWatermarkSettings,
  getVariationThumbnailLogo,
  saveListingWatermarkSettings,
  saveVariationThumbnailLogo,
} from "@/lib/variation-thumbnail-settings";

const schema = z.object({
  dataUrl: z.string().max(3_000_000),
  fileName: z.string().max(180).optional(),
});
const settingsSchema = z.object({
  watermarkText: z.string().trim().max(80).nullable(),
  watermarkOpacity: z.number().min(0.03).max(0.3),
  watermarkLogoSize: z.number().int().min(35).max(220),
  watermarkGap: z.number().int().min(0).max(180),
  applyToIndividualCards: z.boolean(),
});
export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await getListingWatermarkSettings(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const match = input.dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!match) return jsonError("PNG 로고만 저장할 수 있습니다.", 422);
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length > 2_000_000)
      return jsonError("로고는 2MB 이하만 저장할 수 있습니다.", 422);
    const previous = await getVariationThumbnailLogo(user.id);
    const uploaded = await uploadBufferToR2({
      buffer,
      key: `settings/${user.id}/variation-watermark-${Date.now()}.png`,
      contentType: "image/png",
      cacheControl: "public, max-age=3600",
    });
    await saveVariationThumbnailLogo(user.id, uploaded.url, uploaded.key);
    if (previous.logoKey && previous.logoKey !== uploaded.key)
      await deleteObjectFromR2(previous.logoKey);
    return Response.json({
      logoUrl: uploaded.url,
      logoKey: uploaded.key,
      fileName: input.fileName ?? null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError)
      return jsonError("로고 파일을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const input = settingsSchema.parse(await request.json());
    return Response.json(await saveListingWatermarkSettings(user.id, input));
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError)
      return jsonError("워터마크 설정을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
