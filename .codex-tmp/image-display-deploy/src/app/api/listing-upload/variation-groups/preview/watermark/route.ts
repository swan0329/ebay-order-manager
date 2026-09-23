import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getListingImageSettings } from "@/lib/variation-thumbnail-settings";
import { createWatermarkLogoTile, normalizedWatermarkValues } from "@/lib/watermark-render";
import { variationWatermarkSettingLimits, watermarkSettingLimits } from "@/lib/watermark-setting-limits";

const schema = z.object({
  enabled: z.boolean(),
  opacity: z.number().min(watermarkSettingLimits.opacity.min).max(watermarkSettingLimits.opacity.max),
  logoSize: z.number().int().min(variationWatermarkSettingLimits.logoSize.min).max(variationWatermarkSettingLimits.logoSize.max),
  gap: z.number().int().min(variationWatermarkSettingLimits.repeatDistance.min).max(variationWatermarkSettingLimits.repeatDistance.max),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    if (!input.enabled) return Response.json({ tileDataUrl: null });
    const settings = await getListingImageSettings(user.id);
    if (!settings.logoUrl) return jsonError("저장된 워터마크 로고가 없습니다.", 422);
    const response = await fetch(settings.logoUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return jsonError("저장된 워터마크 로고를 불러오지 못했습니다.", 502);
    const tile = await createWatermarkLogoTile(Buffer.from(await response.arrayBuffer()), normalizedWatermarkValues({
      watermarkOpacity: input.opacity,
      watermarkLogoSize: input.logoSize,
      watermarkGap: input.gap,
    }));
    return Response.json({ tileDataUrl: `data:image/png;base64,${tile.toString("base64")}` });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("워터마크 값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
