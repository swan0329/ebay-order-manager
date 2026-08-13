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
} from "@/lib/variation-listing-groups";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";
import { thumbnailIsCurrent, variationThumbnailHash } from "@/lib/variation-thumbnail-state";
import {
  renderListingDescriptionTemplate,
  resolveListingTemplateDefaults,
} from "@/lib/services/listingTemplateService";

const schema = z.object({
  groupKeys: z.array(z.string().min(1)).min(1).max(20),
  confirmed: z.literal(true),
});

const headers = [
  "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
  "Item number",
  "Custom label (SKU)", "Category ID", "Title", "Relationship",
  "Relationship details", "P:UPC", "Start price", "Quantity", "Item photo URL",
  "Condition ID", "Description", "Format", "Duration", "Best Offer Enabled",
  "Immediate pay required", "Location", "Country", "Shipping profile name",
  "Return profile name", "Payment profile name", "C:Original/Reproduction",
  "C:Brand", "C:Type", "C:Set", "C:Genre",
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

    const [readyImages, pricingSettings, templateResult] = await Promise.all([
      getVariationListingReadyImages(),
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
      resolveListingTemplateDefaults(user.id),
    ]);
    if (!pricingSettings) return jsonError("가격 설정을 먼저 저장해 주세요.", 422);
    const storedProducts = await prisma.product.findMany({ where: { id: { in: readyImages.map((row) => row.id) } } });
    const readyImageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
    const products = storedProducts.filter(hasListingPrice).map((product) => ({
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
      const thumbnailHash = variationThumbnailHash(group);
      if (!thumbnailIsCurrent(state, thumbnailHash) || !state?.thumbnailUrl) {
        return jsonError(`${group.title}: 현재 카드 구성의 썸네일을 먼저 만들어 주세요.`, 409);
      }
      const includedIds = Array.isArray(state?.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : [];
      const exportProducts = state?.ebayItemId ? group.products.filter((product) => !includedIds.includes(product.id)) : group.products;
      if (!exportProducts.length) continue;
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
      rows.push({
        [headers[0]]: state?.ebayItemId ? "Revise" : "Add",
        [headers[1]]: state?.ebayItemId ?? "",
        [headers[2]]: parentSku,
        [headers[3]]: buildEbayListingCategoryId(first),
        [headers[4]]: listingTitle,
        [headers[6]]: relationshipDetails(group),
        [headers[10]]: state.thumbnailUrl,
        [headers[11]]: buildEbayListingConditionId({ ebayCondition: first.ebayCondition }),
        [headers[12]]: description,
        [headers[13]]: "FixedPrice", [headers[14]]: "GTC", [headers[15]]: "1",
        [headers[16]]: "1", [headers[17]]: "South Korea", [headers[18]]: "KR",
        [headers[19]]: "Kpop PC New", [headers[20]]: "No Return Accepted (411199464022)",
        [headers[22]]: "Original", [headers[23]]: group.groupName,
        [headers[24]]: "Photocard", [headers[25]]: group.albumName, [headers[26]]: "K-Pop",
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
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "선택을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
