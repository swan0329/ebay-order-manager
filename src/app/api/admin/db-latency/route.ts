import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

// 화면이 느린 원인이 "질의가 무거워서"인지 "왕복이 멀어서"인지 가른다.
// SELECT 1은 실행 시간이 0에 가까우므로 여기서 걸리는 시간은 대부분 왕복이다.
export async function GET() {
  try {
    await requireApiUser();
    const ping: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const started = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      ping.push(Date.now() - started);
    }
    const countStarted = Date.now();
    const [{ count }] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count" FROM "products"`;
    const countMs = Date.now() - countStarted;
    const serverStarted = Date.now();
    const [{ now, region }] = await prisma.$queryRaw<
      Array<{ now: Date; region: string | null }>
    >`SELECT NOW() AS "now", current_setting('server_version', true) AS "region"`;
    const url = (() => {
      try {
        return new URL(process.env.DATABASE_URL ?? "");
      } catch {
        return null;
      }
    })();
    return Response.json({
      ok: true,
      // 접속 정보 중 자격증명은 제외하고 어느 호스트인지만 보여준다.
      host: url?.hostname ?? null,
      connectionLimit: url?.searchParams.get("connection_limit") ?? null,
      pgbouncer: url?.searchParams.get("pgbouncer") ?? null,
      ping: {
        samples: ping,
        min: Math.min(...ping),
        median: percentile(ping, 0.5),
        max: Math.max(...ping),
      },
      productCountMs: countMs,
      productCount: count,
      serverTimeMs: Date.now() - serverStarted,
      postgresVersion: region,
      databaseTimeSkewMs: Date.now() - new Date(now).getTime(),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "DB 응답 시간을 재지 못했습니다.",
      500,
    );
  }
}
