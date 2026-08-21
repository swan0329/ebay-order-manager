import { z } from "zod";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { automationModes, ensureDefaultAutomationRule, previewZeroStockListings, ZERO_STOCK_END_LISTING } from "@/lib/services/automationRules";

const inputSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(automationModes),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().default(false),
});

export async function GET() {
  try {
    await requireApiUser();
    const [rule, events] = await Promise.all([
      ensureDefaultAutomationRule(),
      prisma.automationEvent.findMany({
        where: { rule: { key: ZERO_STOCK_END_LISTING } },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { product: { select: { sku: true, productName: true } } },
      }),
    ]);
    return Response.json({ rule, events });
  } catch (error) {
    return jsonError(error instanceof UnauthorizedError ? "관리자 권한이 필요합니다." : "자동화 규칙을 불러오지 못했습니다.", error instanceof UnauthorizedError ? 401 : 500);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const input = inputSchema.parse(await request.json());
    const candidates = await previewZeroStockListings(user.id);
    if (input.dryRun) {
      return Response.json({ dryRun: true, input, candidates });
    }
    if (input.mode === "AUTOMATIC" && !input.confirmed) {
      return jsonError("자동 실행은 미리보기 확인 후 명시적인 확인이 필요합니다.", 409);
    }
    const rule = await prisma.automationRule.upsert({
      where: { key: ZERO_STOCK_END_LISTING },
      create: { key: ZERO_STOCK_END_LISTING, enabled: input.enabled, mode: input.mode, updatedById: user.id },
      update: { enabled: input.enabled, mode: input.mode, updatedById: user.id },
    });
    return Response.json({ dryRun: false, rule, candidates: candidates.length });
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return jsonError(unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "자동화 규칙을 저장하지 못했습니다.", unauthorized ? 401 : 400);
  }
}
