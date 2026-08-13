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

  const [, legacyResult, stockedSoldOutResult] = await prisma.$transaction([
    prisma.$queryRaw`select 1`,
    prisma.product.updateMany({
      where: { status: "inactive" },
      data: { status: "unlisted" },
    }),
    prisma.product.updateMany({
      where: { status: "sold_out", stockQuantity: { gt: 0 } },
      data: { status: "unlisted" },
    }),
  ]);

  return Response.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    normalized: {
      unlisted: legacyResult.count + stockedSoldOutResult.count,
      legacyInactive: legacyResult.count,
      stockedSoldOut: stockedSoldOutResult.count,
    },
  });
}
