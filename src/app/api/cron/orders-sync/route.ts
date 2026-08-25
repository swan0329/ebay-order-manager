import { jsonError } from "@/lib/http";
import { runScheduledOrderSync } from "@/lib/scheduled-order-sync";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { processEbayInventoryJobs } from "@/lib/services/ebayInventoryJobs";
import { processEbayVariationImageRepairJobs } from "@/lib/services/ebayVariationImageRepair";
import { processShopifyOperationJobs } from "@/lib/services/shopifyOperationJobs";

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
    const queuedJobs = await prisma.productUploadJob.findMany({
      where: { source: { in: ["ebay_inventory_change", "ebay_variation_image_repair", "shopify_operations"] }, status: { in: ["pending", "running"] } },
      select: { userId: true, source: true },
    });
    const queuedSources = new Map<string, Set<string>>();
    for (const job of queuedJobs) queuedSources.set(job.userId, new Set([...(queuedSources.get(job.userId) ?? []), job.source]));
    for (const [userId, sources] of queuedSources) {
      if (sources.has("ebay_inventory_change")) await processEbayInventoryJobs(userId);
      if (sources.has("ebay_variation_image_repair")) await processEbayVariationImageRepairJobs(userId);
      if (sources.has("shopify_operations")) await processShopifyOperationJobs(userId);
    }
  });
  return Response.json(result, { status: result.ok ? 200 : 207 });
}
