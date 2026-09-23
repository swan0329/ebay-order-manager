import { after } from "next/server";
import { z } from "zod";
import {
  createAutomaticProductPublishJob,
  drainChannelPublishJob,
} from "@/lib/channel-publish-jobs";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getRegistrationCandidates } from "@/lib/channel-registration-candidates";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const params = new URL(request.url).searchParams;
    const channel = z.enum(["EBAY", "SHOPIFY"]).parse(params.get("channel"));
    const limit = z.coerce.number().int().min(1).max(500).parse(params.get("limit") ?? 1);
    return Response.json(await getRegistrationCandidates(channel, limit));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError("등록 대상을 확인하지 못했습니다.", 422);
  }
}

const schema = z.object({
  channel: z.enum(["EBAY", "SHOPIFY"]),
  productIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  allEligible: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(1),
  confirmed: z.literal(true),
  expectedOptionProductIds: z.array(z.string().min(1)).min(1).max(40).optional(),
}).refine((input) => Boolean(input.allEligible) !== Boolean(input.productIds), {
  message: "선택 상품 또는 전체 등록 중 하나를 지정해 주세요.",
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    let productIds = input.productIds ?? [];
    let eligibleCount = productIds.length;
    if (input.allEligible) {
      const candidates = await getRegistrationCandidates(input.channel, input.limit);
      eligibleCount = candidates.eligibleCount;
      productIds = candidates.products.map((product) => product.id);
      if (!productIds.length) {
        return jsonError("공급·이미지·가격 조건을 갖춘 미등록 상품이 없습니다.", 422);
      }
    }
    const job = await createAutomaticProductPublishJob({
      userId: user.id,
      channel: input.channel,
      productIds,
      expectedOptionProductIds: input.expectedOptionProductIds,
    });
    after(() => drainChannelPublishJob(job.id).catch(() => undefined));
    return Response.json({
      job,
      reusedActiveJob: job.reusedActiveJob,
      selectedProductCount: job.reusedActiveJob ? job.totalCount : productIds.length,
      remainingProductCount: job.reusedActiveJob ? 0 : Math.max(0, eligibleCount - productIds.length),
    }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("등록 채널과 선택 상품을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 422);
  }
}
