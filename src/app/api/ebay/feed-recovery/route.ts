import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { recoverIncompleteEbayFeedJobs } from "@/lib/ebay-feed-operations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Target = {
  sku?: string;
  itemId?: string;
  quantity?: number;
  inventoryApplied?: boolean;
  inventoryError?: string;
};

function summarize(targetsJson: unknown) {
  const targets = Array.isArray(targetsJson) ? (targetsJson as Target[]) : [];
  const applied = targets.filter((target) => target.inventoryApplied).length;
  const failed = targets.filter((target) => target.inventoryError).length;
  return {
    total: targets.length,
    // 수량이 되돌아간 것
    restored: applied,
    failed,
    // 아직 수량 0으로 잠겨 있는 것. 이 수가 줄어야 상품이 다시 보인다.
    stillHeld: targets.length - applied - failed,
    firstErrors: [
      ...new Set(targets.filter((target) => target.inventoryError).map((target) => target.inventoryError!)),
    ].slice(0, 3),
  };
}

/**
 * 변동처리가 잠가 둔 수량이 얼마나 되돌아갔는지 보여 준다. 되돌리기는 5분마다 도는
 * 정기 실행이 하지만, 그것만 기다리면 사람이 상태를 알 수 없고 재촉할 수도 없다.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const jobs = await prisma.ebayFeedJob.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, operation: true, status: true, error: true, totalCount: true,
        successCount: true, failureCount: true, ebayTaskId: true,
        submittedAt: true, completedAt: true, createdAt: true, targetsJson: true,
      },
    });
    return Response.json({
      ok: true,
      jobs: jobs.map(({ targetsJson, ...job }) => ({ ...job, reflection: summarize(targetsJson) })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

/** 되돌리기를 지금 실행한다. 정기 실행을 기다리지 않아도 된다. */
export async function POST() {
  try {
    const user = await requireApiUser();
    const recovered = await recoverIncompleteEbayFeedJobs(user.id);
    return Response.json({ ok: true, recovered });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
