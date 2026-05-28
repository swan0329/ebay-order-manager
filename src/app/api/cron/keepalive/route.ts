import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return jsonError("Unauthorized", 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  const [, soldOutResult, reactivatedResult] = await prisma.$transaction([
    prisma.$queryRaw`select 1`,
    prisma.product.updateMany({
      where: { stockQuantity: { lte: 0 }, status: { not: "sold_out" } },
      data: { status: "sold_out" },
    }),
    prisma.product.updateMany({
      where: { stockQuantity: { gt: 0 }, status: { not: "active" } },
      data: { status: "active" },
    }),
  ]);

  return Response.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    normalized: { soldOut: soldOutResult.count, reactivated: reactivatedResult.count },
  });
}
