import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { hasListingPrice, resolveListingPriceUsd } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import {
  buildEbayListingCategoryId,
  buildEbayListingConditionId,
  buildEbayListingDescription,
} from "@/lib/ebay-listing-fields";
import {
  buildVariationListingGroups,
  relationshipDetails,
  variationEbayTitle,
  variationParentSku,
  variationSinglesToEnd,
} from "@/lib/variation-listing-groups";
import { EBAY_END_LISTING_REASON } from "@/lib/ebay-end-listing-csv";
import { getVariationListingReadyImages, isPublicListingImageUrl, withVariationListingMetadata } from "@/lib/variation-listing-products";
import { thumbnailIsCurrent, variationThumbnailHash } from "@/lib/variation-thumbnail-state";
import { getListingWatermarkSettings } from "@/lib/variation-thumbnail-settings";
import { listingWatermarkSignature } from "@/lib/listing-watermark";
import {
  renderListingDescriptionTemplate,
  resolveListingTemplateDefaults,
} from "@/lib/services/listingTemplateService";

const schema = z.object({
  groupKeys: z.array(z.string().min(1)).min(1).max(20),
  // Optional for browser tabs that still have the previous JavaScript bundle.
  // When omitted, resolveListingTemplateDefaults safely uses the saved default.
  templateId: z.string().min(1).optional().nullable(),
  confirmed: z.literal(true),
  // 옵션 추가 행 뒤에 기존 단품 종료 행을 같은 파일에 넣는다. eBay 업로드가 한 번으로
  // 끝나고, 단품과 옵션상품이 같이 살아 있는 중복 등록 구간도 거의 사라진다.
  endSingles: z.boolean().optional().default(true),
  // 아직 eBay에 없는 신규 묶음까지 함께 종료할지. Add가 거부되면 단품만 사라지므로
  // 기본은 끄고, 사람이 위험을 알고 켤 때만 넣는다.
  endNewGroupSingles: z.boolean().optional().default(false),
});

const headers = [
  "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
  "Item number",
  "Custom label (SKU)", "Category ID", "Title", "Relationship",
  "Relationship details", "P:UPC", "Start price", "Quantity", "Item photo URL",
  "Condition ID", "ConditionDescription", "Description", "Format", "Duration", "Best Offer Enabled",
  "Best Offer Auto Accept Price", "Minimum Best Offer Price", "Immediate pay required", "Location", "Country", "Shipping profile name",
  "Return profile name", "Payment profile name", "C:Original/Reproduction",
  "C:Brand", "C:Type", "C:Artist", "C:Franchise", "C:Set", "C:Genre",
  "C:Country/Region of Manufacture",
  // End 행에만 쓰는 열. eBay는 종료 사유가 없으면 End 행을 거부한다.
  "EndingReason",
] as const;

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const latestReport = await prisma.ebayReportImport.findFirst({
      where: { userId: user.id, completeSnapshot: true },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!latestReport) return jsonError("먼저 eBay 전체 활성상품 보고서를 가져와 주세요.", 409);

    const [readyImages, pricingSettings, templateResult, watermarkSettings] = await Promise.all([
      getVariationListingReadyImages(),
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
      resolveListingTemplateDefaults(user.id, input.templateId),
      getListingWatermarkSettings(user.id),
    ]);
    if (!pricingSettings) return jsonError("가격 설정을 먼저 저장해 주세요.", 422);
    if (!templateResult.template?.descriptionTemplateHtml?.trim()) {
      return jsonError(
        "상세페이지 HTML이 저장된 등록 템플릿을 선택해 주세요.",
        422,
      );
    }
    const storedProducts = await prisma.product.findMany({ where: { id: { in: readyImages.map((row) => row.id) } } });
    const readyImageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
    const products = (await withVariationListingMetadata(storedProducts)).filter(hasListingPrice).map((product) => ({
      ...product,
      imageUrl: readyImageById.get(product.id) ?? null,
      ebayImageUrls: [],
    }));
    const allGroups = buildVariationListingGroups(products).groups;
    const selected = allGroups.filter((group) => input.groupKeys.includes(group.key));
    if (selected.length !== input.groupKeys.length) {
      return jsonError("선택한 묶음이 변경되었습니다. 화면을 새로고침한 뒤 다시 확인해 주세요.", 409);
    }

    const rows: Record<string, unknown>[] = [];
    for (const group of selected) {
      const state = await prisma.variationListingState.findUnique({ where: { userId_groupKey: { userId: user.id, groupKey: group.key } } });
      const thumbnailHash = variationThumbnailHash(group, listingWatermarkSignature(watermarkSettings));
      if (!thumbnailIsCurrent(state, thumbnailHash) || !state?.thumbnailUrl) {
        return jsonError(`${group.title}: 현재 카드 구성의 썸네일을 먼저 만들어 주세요.`, 409);
      }
      const includedIds = Array.isArray(state?.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : [];
      const exportProducts = state?.ebayItemId ? group.products.filter((product) => !includedIds.includes(product.id)) : group.products;
      if (!exportProducts.length) continue;
      const invalidImages = exportProducts.filter((product) => !isPublicListingImageUrl(product.imageUrl));
      if (invalidImages.length) {
        const cards = invalidImages.slice(0, 5).map((product) => `${product.variationName} (SKU ${product.sku})`).join(", ");
        return jsonError(`${group.title}: eBay에 사용할 공개 이미지가 없는 카드가 있습니다: ${cards}. '선택 묶음 썸네일 만들기'를 다시 눌러 R2 저장을 완료해 주세요.`, 422);
      }
      if (group.products.length > 40) return jsonError(`${group.title}: 옵션은 최대 40장까지 지원합니다.`, 422);
      const priced = group.products.map((product) => ({
        product,
        price: resolveListingPriceUsd(product, pricingSettings)?.priceUsd.toFixed(2),
      }));
      if (priced.some((item) => !item.price)) return jsonError(`${group.title}: 가격이 없는 카드가 있습니다.`, 422);
      const first = group.products[0];
      const listingTitle = variationEbayTitle(group.title);
      const parentSku = variationParentSku(group.key);
      const description = renderListingDescriptionTemplate(
        templateResult.template?.descriptionTemplateHtml,
        {
          descriptionHtml: buildEbayListingDescription(first),
          sku: parentSku,
          price: priced[0]?.price ?? null,
          quantity: 1,
          brand: group.groupName,
          condition: first.ebayCondition,
        },
        listingTitle,
      );
      const conditionDescription = templateResult.template.conditionDescription
        ? renderListingDescriptionTemplate(
            templateResult.template.conditionDescription,
            {
              descriptionHtml: "",
              sku: parentSku,
              price: priced[0]?.price ?? null,
              quantity: 1,
              brand: group.groupName,
              condition: first.ebayCondition,
            },
            listingTitle,
          )
        : "";
      rows.push({
        [headers[0]]: state?.ebayItemId ? "Revise" : "Add",
        [headers[1]]: state?.ebayItemId ?? "",
        [headers[2]]: parentSku,
        [headers[3]]: buildEbayListingCategoryId(first),
        [headers[4]]: listingTitle,
        [headers[6]]: relationshipDetails(group),
        [headers[10]]: state.thumbnailUrl,
        [headers[11]]: buildEbayListingConditionId({ ebayCondition: first.ebayCondition }),
        [headers[12]]: conditionDescription,
        [headers[13]]: description,
        [headers[14]]: "FixedPrice", [headers[15]]: "GTC", [headers[16]]: "1",
        [headers[17]]: templateResult.template.autoAcceptPrice?.toString() ?? "",
        [headers[18]]: templateResult.template.minimumOfferPrice?.toString() ?? "",
        [headers[19]]: templateResult.template.immediatePayRequired ? "1" : "",
        [headers[20]]: "South Korea", [headers[21]]: "KR",
        [headers[22]]: "Kpop PC New", [headers[23]]: "No Return Accepted (411199464022)",
        [headers[25]]: "Original", [headers[26]]: group.groupName,
        [headers[27]]: "Photocard", [headers[28]]: group.groupName,
        [headers[29]]: group.groupName, [headers[30]]: group.albumName,
        [headers[31]]: "K-Pop", [headers[32]]: "South Korea",
      });
      for (const item of priced.filter(({product})=>exportProducts.some((candidate)=>candidate.id===product.id))) {
        rows.push({
          [headers[2]]: item.product.sku,
          [headers[5]]: "Variation",
          [headers[6]]: `Card=${item.product.variationName.replace(/[;|=]/g, " ")}`,
          [headers[7]]: "Does not apply",
          [headers[8]]: item.price,
          [headers[9]]: listingQuantity(item.product),
          [headers[10]]: `${item.product.variationName.replace(/[;|=]/g, " ")}=${item.product.imageUrl || item.product.ebayImageUrls[0]}`,
        });
      }
      // 이 묶음의 카드가 아직 단품으로도 올라가 있으면 같은 파일에서 종료한다.
      // 부모 옵션상품의 Item number는 필요 없다. 종료에 필요한 값(단품의 Item number와
      // SKU)은 직전 보고서에서 이미 상품에 들어와 있으므로, 보고서를 다시 받을 이유가 없다.
      const endable = variationSinglesToEnd({
        products: group.products,
        parentItemId: state?.ebayItemId ?? null,
        endSingles: input.endSingles,
        endNewGroupSingles: input.endNewGroupSingles,
      });
      for (const product of endable) {
        rows.push({
          [headers[0]]: "End",
          [headers[1]]: product.ebayItemId ?? "",
          [headers[2]]: product.sku,
          [headers[33]]: EBAY_END_LISTING_REASON,
        });
      }

      await prisma.variationListingState.upsert({
        where: { userId_groupKey: { userId: user.id, groupKey: group.key } },
        create: { userId: user.id, groupKey: group.key, parentSku: variationParentSku(group.key), title: group.title, pendingProductIds: exportProducts.map((product)=>product.id), lastExportedAt: new Date() },
        update: { title: group.title, pendingProductIds: exportProducts.map((product)=>product.id), lastExportedAt: new Date() },
      });
    }

    const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\r\n");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`\uFEFF${body}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ebay-variation-listings-${date}.csv"`,
        "x-group-count": String(selected.length),
        "x-variation-count": String(selected.reduce((sum, group) => sum + group.products.length, 0)),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const field = String(issue?.path?.[0] ?? "");
      const message =
        field === "groupKeys"
          ? "CSV로 받을 옵션상품 묶음을 선택해 주세요. 한 번에 최대 20개까지 가능합니다."
          : field === "confirmed"
            ? "CSV 생성 확인값이 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요."
            : field === "templateId"
              ? "상세페이지 템플릿을 선택해 주세요."
              : "CSV 입력값을 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.";
      return jsonError(message, 422);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}
