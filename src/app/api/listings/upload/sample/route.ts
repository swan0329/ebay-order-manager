import * as XLSX from "xlsx";
import { asErrorMessage, jsonError } from "@/lib/http";
import { resolveListingTemplateDefaults } from "@/lib/services/listingTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const columns = [
  "sku",
  "title",
  "description_html",
  "price",
  "quantity",
  "image_urls",
  "category_id",
  "condition",
  "payment_policy_id",
  "fulfillment_policy_id",
  "return_policy_id",
  "merchant_location_key",
  "brand",
  "type",
  "country_of_origin",
  "custom_label",
];

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
      image_urls: defaults?.defaultImageUrl ?? "cards/sample.jpg",
      category_id: defaults?.categoryId ?? "",
      condition: defaults?.condition ?? "NEW",
      payment_policy_id: defaults?.paymentProfile ?? "",
      fulfillment_policy_id: defaults?.shippingProfile ?? "",
      return_policy_id: defaults?.returnProfile ?? "",
      merchant_location_key: defaults?.merchantLocationKey ?? "",
      brand: defaults?.brand ?? "KPOP",
      type: defaults?.type ?? "Photocard",
      country_of_origin: defaults?.countryOfOrigin ?? "KR",
      custom_label: defaults?.customLabel ?? "",
    };

    if (format === "xlsx") {
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([row], { header: columns });
      XLSX.utils.book_append_sheet(workbook, sheet, "listing-upload");
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
