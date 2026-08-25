import { z } from "zod";
import { after } from "next/server";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  getEbayOperations,
  getShopifyOperations,
} from "@/lib/services/ebayOperations";
import { pushEbayInventory } from "@/lib/services/ebayInventoryPush";
import {
  issueListingPreviewToken,
  previewListingUpload,
  verifyListingPreviewToken,
} from "@/lib/services/listingUploadSafety";
import { enqueueEbayVariationImageRepairs, getEbayVariationImageRepairJobs, processEbayVariationImageRepairJobs } from "@/lib/services/ebayVariationImageRepair";
import { enqueueEbayInventoryJobs, getEbayInventoryJobSummary, processEbayInventoryJobs } from "@/lib/services/ebayInventoryJobs";
import { getEbayOutOfStockControl } from "@/lib/services/ebayOutOfStockControl";
import { enqueueShopifyOperationJobs, getShopifyOperationJobSummary, processShopifyOperationJobs, reconcileShopifyImageRepairJobs, reconcileShopifyInventoryJobs } from "@/lib/services/shopifyOperationJobs";

const executeSchema = z.object({
  action: z.enum(["CREATE", "CHANGE", "UNAVAILABLE", "REVIEW", "IMAGE_REPAIR"]),
  productIds: z.array(z.string().min(1)).min(1).max(2_000),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().default(false),
  previewToken: z.string().optional(),
  reconcileShopifyImages: z.boolean().default(false),
  reconcileChannelState: z.boolean().default(false),
  channel: z.enum(["EBAY", "SHOPIFY"]).default("EBAY"),
});

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const shopify = new URL(request.url).searchParams.get("channel") === "SHOPIFY";
    const operations = shopify ? await getShopifyOperations() : await getEbayOperations(user.id);
    if (shopify) {
      const shopifyJob = await getShopifyOperationJobSummary(user.id);
      // 화면의 3초 상태 조회 자체는 외부 쓰기가 아니다. 서버리스 after 작업이
      // 중단되면 멱등 재확인이 가능한 이미지·가격·재고 작업을 한 건씩 깨워,
      // 배치가 수십 분 동안 멈추는 일을 막는다.
      if (shopifyJob.active) after(() => processShopifyOperationJobs(user.id, 1));
      return Response.json({ ...operations, shopifyJob });
    }
    const imageRepairJob = await getEbayVariationImageRepairJobs(user.id);
    if (imageRepairJob.active) after(() => processEbayVariationImageRepairJobs(user.id, 1));
    return Response.json({ ...operations, imageRepairJob, inventoryJob: await getEbayInventoryJobSummary(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = executeSchema.parse(await request.json());
    if (input.channel === "SHOPIFY") {
      if (input.reconcileChannelState) {
        if (input.action !== "CHANGE" && input.action !== "UNAVAILABLE") return jsonError("Shopify 가격·재고 재확인 대상이 아닙니다.", 422);
        return Response.json({ reconciled: true, ...await reconcileShopifyInventoryJobs(user.id, input.action, input.productIds) });
      }
      if (input.reconcileShopifyImages) {
        if (input.action !== "IMAGE_REPAIR") return jsonError("Shopify 사진 재확인은 이미지·썸네일 교체 목록에서만 사용할 수 있습니다.", 422);
        const result = await reconcileShopifyImageRepairJobs(user.id, input.productIds);
        return Response.json({ reconciled: true, ...result });
      }
      if (input.action === "REVIEW") return jsonError("주문 예약·수집 필요 항목은 Shopify에 전송하지 않습니다.", 409);
      const current = await getShopifyOperations();
      const source =
        input.action === "CREATE"
          ? current.create
          : input.action === "CHANGE"
            ? current.change
            : input.action === "UNAVAILABLE"
              ? current.unavailable
              : input.action === "IMAGE_REPAIR"
                ? current.imageRepair
                : current.review;
      const allowed = new Set(
        source
          .filter(
            (row) => (row as { actionable?: boolean }).actionable !== false,
          )
          .map((row) => String(row.productId)),
      );
      const productIds = [...new Set(input.productIds)];
      if (productIds.some((id) => !allowed.has(id)))
        return jsonError(
          input.action === "IMAGE_REPAIR"
            ? "최종 승인 이미지가 없거나 Shopify 연결이 불완전한 항목이 포함되어 있습니다."
            : "포카마켓 재고가 확인되지 않았거나 현재 Shopify 전송 대상이 아닌 항목이 포함되어 있습니다.",
          409,
        );
      if (input.dryRun)
        return Response.json({
          dryRun: true,
          planned: productIds.length,
          rows: source.filter((row) =>
            productIds.includes(String(row.productId)),
          ),
          previewToken: issueListingPreviewToken(productIds),
        });
      if (
        !input.confirmed ||
        !input.previewToken ||
        !verifyListingPreviewToken(input.previewToken, productIds)
      )
        return jsonError(
          "유효한 Shopify 미리보기 후 최종 확인이 필요합니다.",
          409,
        );
      const selectedRows = source.filter((row) =>
        productIds.includes(String(row.productId)),
      );
      const job = await enqueueShopifyOperationJobs({
        userId: user.id,
        action: input.action,
        targets: selectedRows.map((row) => ({
          targetId: String(row.productId),
          productIds: ("productIds" in row && Array.isArray(row.productIds) ? row.productIds : [row.productId]).filter((id): id is string => typeof id === "string"),
          sku: String(row.sku),
        })),
      });
      after(() => processShopifyOperationJobs(user.id));
      return Response.json({ queued: true, jobType: "shopify", succeeded: 0, failed: 0, job });
    }
    if (input.action === "CREATE") {
      if (!input.dryRun)
        return jsonError(
          "신규등록 실행은 서명된 신규등록 경로를 사용해 주세요.",
          409,
        );
      const current = await getEbayOperations(user.id);
      const allowed = new Map(
        current.create.flatMap((row) =>
          row.productId ? [[row.productId, row.id] as const] : [],
        ),
      );
      const productIds = [...new Set(input.productIds)];
      if (productIds.some((id) => !allowed.has(id)))
        return jsonError(
          "현재 eBay 필수 검증을 통과한 등록 초안이 아닌 항목이 포함되어 있습니다.",
          409,
        );
      const draftIds = productIds.map((id) => allowed.get(id)!);
      const preview = await previewListingUpload(user.id, draftIds);
      return Response.json({
        ...preview,
        dryRun: true,
        previewToken: preview.valid ? issueListingPreviewToken(draftIds) : null,
      });
    }
    if (input.action === "IMAGE_REPAIR") {
      const current = await getEbayOperations(user.id);
      const allowed = new Set(current.imageRepair.filter((row) => row.actionable).map((row) => row.productId));
      const productIds = [...new Set(input.productIds)];
      if (productIds.some((id) => !allowed.has(id))) return jsonError("현재 활성 상태이거나 최종 승인 이미지가 모두 준비된 eBay 묶음상품이 아닙니다.", 409);
      if (input.dryRun) return Response.json({ dryRun: true, planned: productIds.length, rows: current.imageRepair.filter((row) => productIds.includes(row.productId)), previewToken: issueListingPreviewToken(productIds) });
      if (!input.confirmed || !input.previewToken || !verifyListingPreviewToken(input.previewToken, productIds)) return jsonError("유효한 eBay 이미지 교체 미리보기 후 최종 확인이 필요합니다.", 409);
      const job = await enqueueEbayVariationImageRepairs(user.id, productIds);
      after(() => processEbayVariationImageRepairJobs(user.id));
      return Response.json({ queued: true, succeeded: 0, failed: 0, job });
    }
    if (
      !input.dryRun &&
      (!input.confirmed ||
        !input.previewToken ||
        !verifyListingPreviewToken(input.previewToken, input.productIds))
    )
      return jsonError("유효한 미리보기 후 최종 확인이 필요합니다.", 409);
    const current = await getEbayOperations(user.id);
    const source =
      input.action === "CHANGE"
        ? current.change
        : input.action === "UNAVAILABLE"
          ? current.unavailable
          : current.review;
    const allowed = new Set(
      source
        .filter((row) => row.actionable !== false)
        .map((row) => row.productId),
    );
    const productIds = [...new Set(input.productIds)].filter((id) =>
      allowed.has(id),
    );
    if (productIds.length !== new Set(input.productIds).size)
      return jsonError(
        "현재 대상이 아닌 상품이 포함되어 있습니다. 목록을 새로고침해 주세요.",
        409,
      );
    if (input.dryRun) {
      const result = await pushEbayInventory({ userId: user.id, productIds, dryRun: true, limit: 2_000 });
      if (result.rows.length !== productIds.length) return jsonError("자동 검증 중 재고·연결 상태가 바뀐 항목이 있습니다. 목록을 새로고침한 뒤 다시 시작해 주세요.", 409);
      return Response.json({ ...result, previewToken: issueListingPreviewToken(productIds) });
    }
    if (input.action === "UNAVAILABLE" && !(await getEbayOutOfStockControl(user.id))) {
      return jsonError("eBay 품절 유지 설정이 꺼져 있어 수량 0을 전송할 수 없습니다. 화면의 ‘eBay 품절 유지 설정 켜기’를 먼저 승인해 주세요.", 409);
    }
    const existingJob = await getEbayInventoryJobSummary(user.id);
    if (existingJob.active) return jsonError(`이미 eBay 가격·재고 작업 ${existingJob.active}건이 진행 중입니다. 완료된 뒤 다음 작업을 시작해 주세요.`, 409);
    const job = await enqueueEbayInventoryJobs({ userId: user.id, productIds, action: input.action === "UNAVAILABLE" ? "UNAVAILABLE" : "CHANGE" });
    after(() => processEbayInventoryJobs(user.id));
    return Response.json({ queued: true, jobType: "inventory", succeeded: 0, failed: 0, job });
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError)
      return jsonError("선택 항목을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
