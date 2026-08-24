import { jsonError } from "@/lib/http";
import { runScheduledOrderSync } from "@/lib/scheduled-order-sync";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { processEbayInventoryJobs } from "@/lib/services/ebayInventoryJobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return jsonError("Unauthorized", 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    return jsonError("CRON_SECRET is required.", 500);
  }

  const result = await runScheduledOrderSync();
  // 사용자가 메뉴를 닫은 뒤 서버리스 실행이 중단돼도 다음 30분 주문 수집 때
  // 승인·대기 중이던 eBay 가격·재고 작업을 자동 재개한다.
  after(async () => {
    const queuedUsers = await prisma.productUploadJob.findMany({
      where: { source: "ebay_inventory_change", status: { in: ["pending", "running"] } },
      distinct: ["userId"],
      select: { userId: true },
    });
    for (const { userId } of queuedUsers) await processEbayInventoryJobs(userId);
  });
  return Response.json(result, { status: result.ok ? 200 : 207 });
}
