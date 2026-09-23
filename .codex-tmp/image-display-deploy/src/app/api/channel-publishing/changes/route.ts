import { getEbayVariationMembershipByProductId } from "@/lib/variation-listing-products";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { selectChangedProducts } from "@/lib/change-product-selection";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError, asErrorMessage } from "@/lib/http";
import { getChannelImageChanges } from "@/lib/channel-image-changes";
import { createChannelPublishJob, createShopifyAutomaticOperationJob, drainChannelPublishJob, getShopifyAutomaticOperationProductIds } from "@/lib/channel-publish-jobs";
import { getEbayFeedOperationTargets, submitEbayFeedOperation } from "@/lib/ebay-feed-operations";

export const maxDuration = 300;
const schema = z.object({ channel: z.enum(["EBAY", "SHOPIFY"]), skus: z.array(z.string().trim().min(1).max(100)).min(1).max(500).optional() });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { channel, skus } = schema.parse(await request.json());
    const selected = skus === undefined ? undefined : await prisma.product.findMany({
      where: { sku: { in: [...new Set(skus)] } }, select: { id: true, sku: true, ebayItemId: true, shopifyProductId: true },
    });
    const missing = skus?.filter(sku => !selected?.some(p => p.sku === sku)) ?? [];
    if (missing.length) return jsonError(`찾을 수 없는 상품번호: ${[...new Set(missing)].join(", ")}. 번호를 수정한 뒤 다시 실행해 주세요.`, 422);
    const membership = channel === "EBAY" ? await getEbayVariationMembershipByProductId(user.id) : new Map<string, string>();
    const parentFor = (p: { id: string; ebayItemId: string | null; shopifyProductId: string | null }) => channel === "EBAY" ? membership.get(p.id) ?? p.ebayItemId : p.shopifyProductId;
    const productIds = selected?.map(p => p.id);
    const parentIds = selected === undefined ? undefined : new Set(selected.map(parentFor).filter(Boolean));
    const unlinked = selected?.filter(p => !parentFor(p)).map(p => p.sku) ?? [];
    // Separate queues let stock/price changes proceed even if an image is missing.
    // Both results are returned: partial submission must never look like total success.
    const results = await Promise.allSettled([
      (async () => {
        const candidates = channel === "EBAY"
          ? await getEbayFeedOperationTargets(user.id, "revise")
          : await getShopifyAutomaticOperationProductIds("revise");
        const targets = selectChangedProducts(candidates.map(row => "productId" in row ? row.productId : row.id), productIds, id => id);
        if (!targets.length) return null;
        const job = channel === "EBAY"
          ? await submitEbayFeedOperation(user.id, "revise", undefined, undefined, productIds)
          : await createShopifyAutomaticOperationJob({ userId: user.id, operation: "revise", productIds });
        if (channel === "SHOPIFY") after(() => drainChannelPublishJob(job.id).catch(() => undefined));
        return job;
      })(),
      (async () => {
        const targets = (await getChannelImageChanges(user.id, channel)).filter(t => parentIds === undefined || parentIds.has(t.parent));
        if (!targets.length) return null;
        const job = await createChannelPublishJob({ userId: user.id, channel, mode: "IMAGES", targetIds: targets.slice(0, 500).map(t =>
          selected?.find(p => parentFor(p) === t.parent)?.id ?? t.productId) });
        after(() => drainChannelPublishJob(job.id).catch(() => undefined));
        return job;
      })(),
    ]);
    return Response.json({
      job: results[0].status === "fulfilled" ? results[0].value : null,
      imageJob: results[1].status === "fulfilled" ? results[1].value : null,
      notes: unlinked.length ? [`채널 미등록으로 제외: ${unlinked.join(", ")}`] : [],
      errors: results.flatMap((r, i) => r.status === "rejected" ? [`${i ? "이미지" : "가격·재고"}: ${asErrorMessage(r.reason)}`] : []),
    }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 422);
  }
}
