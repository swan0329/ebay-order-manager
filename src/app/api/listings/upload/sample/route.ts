import * as XLSX from "xlsx";
import { asErrorMessage, jsonError } from "@/lib/http";
import { resolveListingTemplateDefaults } from "@/lib/services/listingTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const requiredColumns = [
  "sku",
  "title",
  "price",
  "quantity",
  "image_urls",
];

const optionalColumns = [
  "source_inventory_id",
  "description_html",
  "category_id",
  "condition",
  "condition_description",
  "item_specifics_json",
  "payment_policy_id",
  "fulfillment_policy_id",
  "return_policy_id",
  "merchant_location_key",
  "brand",
  "type",
  "country_of_origin",
  "custom_label",
  "best_offer_enabled",
  "minimum_offer_price",
  "auto_accept_price",
  "private_listing",
  "immediate_pay_required",
];
const columns = [...requiredColumns, ...optionalColumns];

const columnDescriptions: Record<string, string> = {
  sku: "eBay Inventory SKU. 기존 SKU는 update/revise 대상입니다.",
  title: "eBay 리스팅 제목",
  price: "판매가",
  quantity: "업로드 수량",
  image_urls: "공개 이미지 URL 또는 R2 key. 여러 이미지는 쉼표로 구분합니다.",
  source_inventory_id: "로컬 재고 상품 id. 비워도 SKU로 재고 연결을 시도합니다.",
  description_html: "HTML 상세설명",
  category_id: "eBay category id",
  condition: "예: NEW",
  condition_description: "상태 상세 설명",
  item_specifics_json: "예: {\"Brand\":[\"IVE\"],\"Type\":[\"Photocard\"]}",
  payment_policy_id: "eBay payment policy id",
  fulfillment_policy_id: "eBay fulfillment/shipping policy id",
  return_policy_id: "eBay return policy id",
  merchant_location_key: "Inventory location key",
};

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const templateId = url.searchParams.get("templateId");
    const format = url.searchParams.get("format") || "csv";
    const { defaults } = await resolveListingTemplateDefaults(user.id, templateId);
    const row = {
      sku: defaults?.autoGenerateSku ? "" : `${defaults?.skuPrefix ?? "SKU"}-001`,
      title: "Sample Photocard",
      description_html: defaults?.descriptionHtml ?? "<p>Sample Photocard</p>",
      price: defaults?.price ?? "9.99",
      quantity: defaults?.quantity ?? 1,
      image_urls:
        defaults?.defaultImageUrl ??
        "https://example.com/card-front.jpg,https://example.com/card-back.jpg",
      source_inventory_id: "",
      category_id: defaults?.categoryId ?? "",
      condition: defaults?.condition ?? "NEW",
      condition_description: defaults?.conditionDescription ?? "",
      item_specifics_json: JSON.stringify({
        Brand: [defaults?.brand ?? "IVE"],
        Type: [defaults?.type ?? "Photocard"],
        Country: [defaults?.countryOfOrigin ?? "KR"],
      }),
      payment_policy_id: defaults?.paymentProfile ?? "",
      fulfillment_policy_id: defaults?.shippingProfile ?? "",
      return_policy_id: defaults?.returnProfile ?? "",
      merchant_location_key: defaults?.merchantLocationKey ?? "",
      brand: defaults?.brand ?? "KPOP",
      type: defaults?.type ?? "Photocard",
      country_of_origin: defaults?.countryOfOrigin ?? "KR",
      custom_label: defaults?.customLabel ?? "",
      best_offer_enabled: defaults?.bestOfferEnabled ? "true" : "",
      minimum_offer_price: defaults?.minimumOfferPrice ?? "",
      auto_accept_price: defaults?.autoAcceptPrice ?? "",
      private_listing: defaults?.privateListing ? "true" : "",
      immediate_pay_required: defaults?.immediatePayRequired ? "true" : "",
    };

    if (format === "xlsx") {
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([row], { header: columns });
      const columnSheet = XLSX.utils.json_to_sheet(
        columns.map((column) => ({
          column,
          required: requiredColumns.includes(column) ? "필수" : "선택",
          description: columnDescriptions[column] ?? "",
        })),
      );
      XLSX.utils.book_append_sheet(workbook, sheet, "listing-upload");
      XLSX.utils.book_append_sheet(workbook, columnSheet, "columns");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const body = new Blob([new Uint8Array(buffer)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      return new Response(body, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="listing-upload-template.xlsx"',
        },
      });
    }

    const csv = [columns.join(","), columns.map((column) => csvEscape(row[column as keyof typeof row])).join(",")].join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="listing-upload-template.csv"',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
