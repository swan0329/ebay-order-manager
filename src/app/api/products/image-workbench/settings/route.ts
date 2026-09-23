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
  enhancementEnabled: z.boolean().default(true),
  enhancementModel: z.enum(["RealESRGAN_x2plus", "RealESRGAN_x4plus", "4x-UltraSharp"]).default("RealESRGAN_x2plus"),
  enhancementScale: z.union([z.literal(2), z.literal(4)]).default(2),
  enhancementStrength: z.number().int().min(0).max(100).default(45),
}).superRefine((value, ctx) => {
  if (value.enhancementModel === "RealESRGAN_x2plus" && value.enhancementScale !== 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enhancementScale"], message: "RealESRGAN_x2plus는 2배로만 실행할 수 있습니다." });
  }
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
