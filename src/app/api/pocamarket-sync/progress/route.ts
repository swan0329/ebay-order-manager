import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const batch = await prisma.pocamarketSyncBatch.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        scannedCount: true,
        totalCount: true,
        updatedAt: true,
      },
    });
    return Response.json({ batch });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError("최신화 진행 상태를 조회하지 못했습니다.", 500);
  }
}
