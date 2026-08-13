import { z } from "zod";
import { jsonError } from "@/lib/http";
import { getPocamarketSyncSettings, pocamarketSpeedProfiles } from "@/lib/pocamarket-sync";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  enabled: z.boolean(),
  scheduledHour: z.number().int().min(0).max(23),
  dailyBatchSize: z.number().int().min(1).max(10_000),
  speedProfile: z.enum(["AUTO", "FAST", "BALANCED", "SAFE"]),
  priorityStrategy: z.enum([
    "SMART",
    "MISSING_PRICE",
    "NEVER_SYNCED",
    "OLDEST",
    "PRICE_CHANGED",
  ]),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json({ settings: await getPocamarketSyncSettings(user.id), profiles: pocamarketSpeedProfiles });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError("설정을 읽지 못했습니다.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const settings = await prisma.pocamarketSyncSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...input,
        scheduledMinute: 0,
      },
      update: {
        ...input,
        scheduledMinute: 0,
      },
    });
    return Response.json({ settings });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("예약 시간, 처리 개수 또는 속도 설정이 올바르지 않습니다.", 422);
    return jsonError("설정을 저장하지 못했습니다.", 500);
  }
}
