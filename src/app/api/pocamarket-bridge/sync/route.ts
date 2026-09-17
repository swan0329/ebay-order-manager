import { z } from "zod";
import { jsonError } from "@/lib/http";
import {
  nextPocamarketSyncItem,
  ensureScheduledPocamarketSync,
  pocamarketSpeedProfiles,
  recordPocamarketObservation,
} from "@/lib/pocamarket-sync";
import { validBridgeToken } from "@/lib/pocamarket-purchases";

const patchSchema = z.object({
  itemId: z.string().min(1),
  device: z.string().max(100).optional().nullable(),
  availability: z.enum(["AVAILABLE", "SOLD_OUT"]).optional(),
  observedPrice: z.number().positive().optional(),
  errorMessage: z.string().max(1000).optional(),
  safetyStop: z.boolean().optional(),
});

export async function GET(request: Request) {
  if (!validBridgeToken(request)) return jsonError("Unauthorized", 401);
  const device = new URL(request.url).searchParams.get("device")?.slice(0, 100) || null;
  const schedule = await ensureScheduledPocamarketSync();
  const profileName = schedule?.settings.speedProfile as keyof typeof pocamarketSpeedProfiles | undefined;
  return Response.json({
    item: await nextPocamarketSyncItem(device),
    speed: pocamarketSpeedProfiles[profileName ?? "BALANCED"] ?? pocamarketSpeedProfiles.BALANCED,
  });
}

export async function PATCH(request: Request) {
  if (!validBridgeToken(request)) return jsonError("Unauthorized", 401);
  try {
    const input = patchSchema.parse(await request.json());
    const result = await recordPocamarketObservation(
      input.itemId,
      input.device ?? null,
      input,
    );
    return Response.json({ item: result });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError("잘못된 관측 결과입니다.", 422);
    return jsonError(error instanceof Error ? error.message : "결과를 저장하지 못했습니다.", 409);
  }
}
