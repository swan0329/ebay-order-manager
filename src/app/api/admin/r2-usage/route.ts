import { z } from "zod";
import { buildR2UsageReport } from "@/lib/r2-usage";
import { jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

const schema = z.object({
  cursor: z.string().min(1).max(4_096).nullish(),
  budgetMs: z.number().int().min(1_000).max(45_000).default(35_000),
});

// 저장 현황만 읽는다. 이 경로는 어떤 객체도 지우지 않는다.
export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse(await request.json().catch(() => ({})));
    return Response.json({
      ok: true,
      ...(await buildR2UsageReport({
        cursor: input.cursor ?? null,
        budgetMs: input.budgetMs,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(
      error instanceof Error ? error.message : "R2 사용량 조회 실패",
      500,
    );
  }
}
