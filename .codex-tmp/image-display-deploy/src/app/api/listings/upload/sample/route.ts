import { readFile } from "node:fs/promises";
import path from "node:path";
import { asErrorMessage, jsonError } from "@/lib/http";
import { resolveListingTemplateDefaults } from "@/lib/services/listingTemplateService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const ebayTemplatePath = path.join(
  process.cwd(),
  "public",
  "templates",
  "eBay-category-listing-template.xlsx",
);

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
  "promoted_listing_enabled",
  "promoted_campaign_id",
  "promoted_ad_rate",
  "promoted_funding_model",
];
const columns = [...requiredColumns, ...optionalColumns];

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
      promoted_listing_enabled: defaults?.promotedListingEnabled ? "true" : "",
      promoted_campaign_id: defaults?.promotedCampaignId ?? "",
      promoted_ad_rate: defaults?.promotedAdRate ?? "",
      promoted_funding_model: defaults?.promotedFundingModel ?? "COST_PER_SALE",
    };

    if (format === "xlsx") {
      const buffer = await readFile(ebayTemplatePath);
      const body = new Blob([new Uint8Array(buffer)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      return new Response(body, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="eBay-category-listing-template.xlsx"',
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
