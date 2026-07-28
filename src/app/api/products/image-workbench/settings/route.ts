import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getImageWorkbenchSettings, saveImageWorkbenchSettings } from "@/lib/image-workbench-settings";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  brightness: z.number().int().min(-20).max(30),
  contrast: z.number().int().min(-30).max(30),
  saturation: z.number().int().min(-30).max(40),
  sharpness: z.number().int().min(0).max(30),
  watermarkStrength: z.number().int().min(70).max(140),
  localAiEnabled: z.boolean(),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await getImageWorkbenchSettings(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const settings = schema.parse(await request.json());
    await saveImageWorkbenchSettings(user.id, settings);
    return Response.json({ ok: true, ...settings });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("보정 설정값을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
