import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

/**
 * 어떤 날 우리가 eBay에 무엇을 했는지 그대로 보여 준다. 수수료가 왜 붙었는지
 * 따질 때 그날 무슨 작업이 돌았는지부터 봐야 한다. 읽기만 한다.
 */
export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    // 수수료가 붙은 리스팅을 우리가 언제 만들었는지 대조한다. 그날 새로 만든
    // 것이면 새 등록이고, 예전 것이면 이미 있던 리스팅에 다시 붙은 것이다.
    const items = (url.searchParams.get("items") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (items.length) {
      const drafts = await prisma.listingDraft.findMany({
        where: { ebayItemId: { in: items } },
        select: {
          ebayItemId: true,
          sku: true,
          status: true,
          categoryId: true,
          listingFormat: true,
          quantity: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const active = await prisma.ebayActiveListing.findMany({
        where: { itemId: { in: items } },
        orderBy: { createdAt: "asc" },
        select: { itemId: true, sku: true, status: true, createdAt: true },
      });
      const firstSeen = new Map<string, Date>();
      for (const row of active)
        if (!firstSeen.has(row.itemId)) firstSeen.set(row.itemId, row.createdAt);
      const byCategory = new Map<string, number>();
      for (const draft of drafts) {
        const key = draft.categoryId ?? "(없음)";
        byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
      }
      return Response.json({
        ok: true,
        asked: items.length,
        found: drafts.length,
        byCategory: [...byCategory.entries()].map(([categoryId, count]) => ({ categoryId, count })),
        drafts: drafts.slice(0, 20),
        firstSeen: [...firstSeen.entries()].map(([itemId, seenAt]) => ({ itemId, seenAt })),
      });
    }
    const from = new Date(url.searchParams.get("from") ?? "");
    const to = new Date(url.searchParams.get("to") ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
      return jsonError("from·to 날짜가 필요합니다.", 422);
    to.setHours(23, 59, 59, 999);

    const jobs = await prisma.ebayFeedJob.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        operation: true,
        feedType: true,
        status: true,
        totalCount: true,
        successCount: true,
        failureCount: true,
        createdAt: true,
        completedAt: true,
        error: true,
      },
    });
    // 이 기간에 새 리스팅 번호를 받은 건들. 재등록이면 여기에 찍힌다.
    const drafts = await prisma.listingDraft.findMany({
      where: { updatedAt: { gte: from, lte: to }, ebayItemId: { not: null } },
      orderBy: { updatedAt: "asc" },
      select: {
        sku: true,
        ebayItemId: true,
        status: true,
        categoryId: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 2000,
    });
    const reports = await prisma.ebayReportImport.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" },
      select: { fileName: true, rowCount: true, endedCount: true, createdAt: true },
    });

    const byOperation = new Map<string, { jobs: number; total: number; success: number; failure: number }>();
    for (const job of jobs) {
      const key = `${job.operation} · ${job.feedType}`;
      const row = byOperation.get(key) ?? { jobs: 0, total: 0, success: 0, failure: 0 };
      row.jobs += 1;
      row.total += job.totalCount;
      row.success += job.successCount;
      row.failure += job.failureCount;
      byOperation.set(key, row);
    }

    return Response.json({
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      feedJobs: jobs.length,
      byOperation: [...byOperation.entries()].map(([key, value]) => ({ operation: key, ...value })),
      jobs: jobs.slice(0, 50),
      newListingIds: drafts.length,
      draftCategories: [
        ...drafts
          .reduce((map, draft) => {
            const key = draft.categoryId ?? "(없음)";
            map.set(key, (map.get(key) ?? 0) + 1);
            return map;
          }, new Map<string, number>())
          .entries(),
      ].map(([categoryId, count]) => ({ categoryId, count })),
      // 이 기간에 처음 만들어진 초안인지, 예전 초안이 다시 올라간 것인지 구분한다.
      draftsCreatedInRange: drafts.filter((draft) => draft.createdAt >= from).length,
      drafts: drafts.slice(0, 30),
      reports,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
