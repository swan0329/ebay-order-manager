import { getProcurementSafetySummary } from "@/lib/procurement-maintenance";
import { getChannelImageChanges } from "@/lib/channel-image-changes";
import { getLatestImagePublishJobs } from "@/lib/channel-publish-jobs";
import { getChannelOperationCounts } from "@/lib/channel-operation-counts";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { coalesceInFlightRead } from "@/lib/in-flight-read";

export const dynamic = "force-dynamic";
const readCounts = coalesceInFlightRead(async (userId: string) => {
  const counts = await getChannelOperationCounts(userId);
  const ebayImages = await getChannelImageChanges(userId, "EBAY");
  const shopifyImages = await getChannelImageChanges(userId, "SHOPIFY");
  const imageJobs = await getLatestImagePublishJobs(userId);
  const procurement = await getProcurementSafetySummary();
  return { ...counts, procurement, images: { ebay: ebayImages.length, shopify: shopifyImages.length }, imageJobs };
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await readCounts(user.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(/connection pool|P2024/i.test(asErrorMessage(error)) ? "처리 요청이 몰려 대상 수 조회가 지연됐습니다. 잠시 후 다시 계산해 주세요. 진행 중인 작업이 실패했다는 뜻은 아닙니다." : "채널 대상 수를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}
