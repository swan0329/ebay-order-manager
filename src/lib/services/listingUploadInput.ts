import * as XLSX from "xlsx";
import { z } from "zod";
import type { ListingUploadInput } from "@/lib/services/inventoryService";

type ListingRow = Record<string, unknown>;

export type ListingUploadDraft = {
  sku?: string | null;
  title?: string | null;
  descriptionHtml?: string | null;
  price?: string | number | null;
  quantity?: string | number | null;
  imageUrls?: string | string[] | null;
  categoryId?: string | null;
  condition?: string | null;
  conditionDescription?: string | null;
  listingDuration?: string | null;
  listingFormat?: string | null;
  shippingProfile?: string | null;
  returnProfile?: string | null;
  paymentProfile?: string | null;
  merchantLocationKey?: string | null;
  marketplaceId?: string | null;
  currency?: string | null;
  shippingService?: string | null;
  handlingTime?: string | number | null;
  internationalShippingEnabled?: boolean | string | null;
  excludedLocations?: string | string[] | null;
  bestOfferEnabled?: boolean | string | null;
  minimumOfferPrice?: string | number | null;
  autoAcceptPrice?: string | number | null;
  privateListing?: boolean | string | null;
  immediatePayRequired?: boolean | string | null;
  itemSpecifics?: Record<string, string[]> | string | null;
  brand?: string | null;
  type?: string | null;
  countryOfOrigin?: string | null;
  customLabel?: string | null;
  defaultImageUrl?: string | null;
  imageUrlMode?: string | null;
  maxImages?: string | number | null;
  r2UrlPrefix?: string | null;
  skuPrefix?: string | null;
  autoGenerateSku?: boolean | string | null;
};

type NormalizeOptions = {
  templateDefaults?: ListingUploadDraft;
  rowIndex?: number;
};

function r2PublicBaseUrl(customPrefix?: string | null) {
  return (
    customPrefix?.trim() ||
    process.env.R2_PUBLIC_BASE_URL?.trim() ||
    process.env.CLOUDFLARE_R2_PUBLIC_URL?.trim() ||
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL?.trim() ||
    ""
  ).replace(/\/+$/, "");
}

function rowValue(row: ListingRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function parseImageList(value: string) {
  return value
    .split(/[\n,;|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseStringList(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  return parseImageList(String(value ?? ""));
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim() !== "";
  }

  return true;
}

function pickValue<T>(...values: T[]) {
  return values.find(hasValue);
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value ?? "").trim().toLowerCase();

  if (!text) {
    return undefined;
  }

  if (["1", "true", "yes", "y", "on", "사용", "예"].includes(text)) {
    return true;
  }

  if (["0", "false", "no", "n", "off", "미사용", "아니오"].includes(text)) {
    return false;
  }

  return undefined;
}

function toOptionalNumber(value: unknown) {
  if (!hasValue(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseItemSpecifics(value: ListingUploadDraft["itemSpecifics"]) {
  if (!value) {
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, values]) => [
          key.trim(),
          Array.isArray(values)
            ? values.map((entry) => String(entry).trim()).filter(Boolean)
            : [String(values).trim()].filter(Boolean),
        ])
        .filter(([key, values]) => key && (values as string[]).length),
    ) as Record<string, string[]>;
  }

  const text = String(value).trim();

  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parseItemSpecifics(parsed as Record<string, string[]>);
    }
  } catch {
    // Fall through to key:value parsing.
  }

  const entries = text
    .split(/[\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, rawValue] = entry.split(/[:=]/, 2);
      return [
        key?.trim() ?? "",
        String(rawValue ?? "")
          .split(/[|,]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ] as const;
    })
    .filter(([key, values]) => key && values.length);

  return Object.fromEntries(entries);
}

function renderTemplate(template: string | null | undefined, values: ListingUploadDraft) {
  if (!template) {
    return template;
  }

  const imageUrls = parseStringList(values.imageUrls);
  const replacements: Record<string, string> = {
    sku: String(values.sku ?? ""),
    title: String(values.title ?? ""),
    price: String(values.price ?? ""),
    quantity: String(values.quantity ?? ""),
    brand: String(values.brand ?? ""),
    condition: String(values.condition ?? ""),
    image_urls: imageUrls.join(", "),
    type: String(values.type ?? ""),
    custom_label: String(values.customLabel ?? ""),
    country_of_origin: String(values.countryOfOrigin ?? ""),
  };

  return template.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_, key: string) => replacements[key] ?? "");
}

function generatedSku(draft: ListingUploadDraft, rowIndex?: number) {
  const shouldGenerate = toBoolean(draft.autoGenerateSku);

  if (!shouldGenerate) {
    return null;
  }

  const prefix = String(draft.skuPrefix ?? "SKU").trim().replace(/[-_\s]*$/, "");
  const suffix = `${Date.now().toString(36).toUpperCase()}${rowIndex ? `-${rowIndex}` : ""}`;
  return `${prefix}-${suffix}`;
}

function systemDefaults(): ListingUploadDraft {
  return {
    condition: "NEW",
    marketplaceId: "EBAY_US",
    currency: "USD",
    listingFormat: "FIXED_PRICE",
  };
}

export function resolveListingImageUrl(value: string, customPrefix?: string | null) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const baseUrl = r2PublicBaseUrl(customPrefix);

  if (!baseUrl) {
    return value;
  }

  return `${baseUrl}/${value.replace(/^\/+/, "")}`;
}

export function resolveListingImageUrls(
  value: string | string[] | null | undefined,
  fallback?: string | string[] | null,
  customPrefix?: string | null,
) {
  const values = parseStringList(hasValue(value) ? value : fallback);
  return [...new Set(values.map((entry) => resolveListingImageUrl(entry, customPrefix)))];
}

export const listingUploadSchema = z.object({
  sku: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(80),
  descriptionHtml: z.string().trim().min(1),
  price: z.coerce.number().positive().transform((value) => value.toFixed(2)),
  quantity: z.coerce.number().int().min(0),
  imageUrls: z.array(z.string().trim().min(1)).min(1),
  categoryId: z.string().trim().min(1),
  condition: z.string().trim().min(1).default("NEW"),
  conditionDescription: z.string().trim().optional().nullable(),
  listingDuration: z.string().trim().optional().nullable(),
  listingFormat: z.string().trim().optional().nullable(),
  shippingProfile: z.string().trim().min(1),
  returnProfile: z.string().trim().min(1),
  paymentProfile: z.string().trim().optional().nullable(),
  merchantLocationKey: z.string().trim().optional().nullable(),
  marketplaceId: z.string().trim().optional().nullable(),
  currency: z.string().trim().optional().nullable(),
  shippingService: z.string().trim().optional().nullable(),
  handlingTime: z.coerce.number().int().min(0).optional().nullable(),
  internationalShippingEnabled: z.boolean().optional().nullable(),
  excludedLocations: z.array(z.string().trim().min(1)).optional().default([]),
  bestOfferEnabled: z.boolean().optional().nullable(),
  minimumOfferPrice: z.coerce.number().positive().transform((value) => value.toFixed(2)).optional().nullable(),
  autoAcceptPrice: z.coerce.number().positive().transform((value) => value.toFixed(2)).optional().nullable(),
  privateListing: z.boolean().optional().nullable(),
  immediatePayRequired: z.boolean().optional().nullable(),
  itemSpecifics: z.record(z.string(), z.array(z.string())).optional().default({}),
  brand: z.string().trim().optional().nullable(),
  type: z.string().trim().optional().nullable(),
  countryOfOrigin: z.string().trim().optional().nullable(),
  customLabel: z.string().trim().optional().nullable(),
});

export function mergeListingUploadDrafts(
  primary: ListingUploadDraft,
  templateDefaults?: ListingUploadDraft | null,
  options?: { rowIndex?: number },
) {
  const system = systemDefaults();
  const base: ListingUploadDraft = {};
  const keys = new Set([
    ...Object.keys(system),
    ...Object.keys(templateDefaults ?? {}),
    ...Object.keys(primary),
  ] as Array<keyof ListingUploadDraft>);

  for (const key of keys) {
    base[key] = pickValue(primary[key], templateDefaults?.[key], system[key]) as never;
  }

  const sku = pickValue(primary.sku, templateDefaults?.sku, generatedSku(base, options?.rowIndex));
  const rawImages = resolveListingImageUrls(
    primary.imageUrls,
    templateDefaults?.imageUrls ?? templateDefaults?.defaultImageUrl,
    String(base.r2UrlPrefix ?? ""),
  );
  const maxImages = toOptionalNumber(base.maxImages);
  const itemSpecifics = {
    ...parseItemSpecifics(templateDefaults?.itemSpecifics),
    ...parseItemSpecifics(primary.itemSpecifics),
  };

  if (base.brand) {
    itemSpecifics.Brand = [String(base.brand)];
  }

  if (base.type) {
    itemSpecifics.Type = [String(base.type)];
  }

  if (base.countryOfOrigin) {
    itemSpecifics.Country = [String(base.countryOfOrigin)];
  }

  const descriptionHtml =
    pickValue(primary.descriptionHtml, undefined) ??
    renderTemplate(templateDefaults?.descriptionHtml, {
      ...base,
      sku,
      imageUrls: rawImages,
    }) ??
    (base.title ? `<p>${String(base.title)}</p>` : "");

  return {
    ...base,
    sku,
    descriptionHtml,
    imageUrls: maxImages ? rawImages.slice(0, maxImages) : rawImages,
    excludedLocations: parseStringList(base.excludedLocations),
    handlingTime: toOptionalNumber(base.handlingTime),
    internationalShippingEnabled: toBoolean(base.internationalShippingEnabled),
    bestOfferEnabled: toBoolean(base.bestOfferEnabled),
    privateListing: toBoolean(base.privateListing),
    immediatePayRequired: toBoolean(base.immediatePayRequired),
    itemSpecifics,
  } satisfies ListingUploadDraft;
}

export function coerceListingUploadInput(
  primary: ListingUploadDraft,
  templateDefaults?: ListingUploadDraft | null,
  options?: { rowIndex?: number },
): ListingUploadInput {
  return listingUploadSchema.parse(
    mergeListingUploadDrafts(primary, templateDefaults, options),
  );
}

export function readListingUploadRowDraft(row: ListingRow): ListingUploadDraft {
  const title =
    rowValue(row, ["title", "ebay_title", "product_name", "상품명", "제품명"]) ||
    [
      rowValue(row, ["brand", "그룹명"]),
      rowValue(row, ["category", "앨범명"]),
      rowValue(row, ["option_name", "멤버"]),
    ]
      .filter(Boolean)
      .join(" ");

  return {
    sku: rowValue(row, ["sku", "SKU", "상품번호", "상품 번호"]),
    title,
    descriptionHtml: rowValue(row, ["description_html", "description", "상세설명", "설명"]),
    price: rowValue(row, ["price", "ebay_price", "sale_price", "판매가", "포카마켓 가격"]),
    quantity: rowValue(row, ["quantity", "stock_quantity", "재고", "수량"]),
    imageUrls: rowValue(row, [
      "image_urls",
      "image_url",
      "images",
      "이미지 URL",
      "이미지",
      "포카마켓 이미지",
      "r2_key",
      "r2_keys",
    ]),
    categoryId: rowValue(row, ["category_id", "ebay_category_id", "eBay 카테고리 ID"]),
    condition: rowValue(row, ["condition", "ebay_condition", "상태"]),
    conditionDescription: rowValue(row, ["condition_description", "condition_desc"]),
    listingDuration: rowValue(row, ["listing_duration"]),
    listingFormat: rowValue(row, ["listing_format"]),
    shippingProfile: rowValue(row, [
      "shipping_profile",
      "fulfillment_policy_id",
      "shipping_policy_id",
      "배송 정책",
    ]),
    returnProfile: rowValue(row, ["return_profile", "return_policy_id", "반품 정책"]),
    paymentProfile: rowValue(row, ["payment_profile", "payment_policy_id", "결제 정책"]),
    merchantLocationKey: rowValue(row, ["merchant_location_key", "location_key", "출고지"]),
    marketplaceId: rowValue(row, ["marketplace_id", "marketplace"]),
    currency: rowValue(row, ["currency", "통화"]),
    shippingService: rowValue(row, ["shipping_service"]),
    handlingTime: rowValue(row, ["handling_time"]),
    internationalShippingEnabled: rowValue(row, ["international_shipping_enabled"]),
    excludedLocations: rowValue(row, ["excluded_locations"]),
    bestOfferEnabled: rowValue(row, ["best_offer_enabled"]),
    minimumOfferPrice: rowValue(row, ["minimum_offer_price"]),
    autoAcceptPrice: rowValue(row, ["auto_accept_price"]),
    privateListing: rowValue(row, ["private_listing"]),
    immediatePayRequired: rowValue(row, ["immediate_pay_required"]),
    itemSpecifics: rowValue(row, ["item_specifics", "item_specifics_json"]),
    brand: rowValue(row, ["brand", "브랜드", "그룹명"]),
    type: rowValue(row, ["type", "종류"]),
    countryOfOrigin: rowValue(row, ["country_of_origin", "원산지"]),
    customLabel: rowValue(row, ["custom_label", "custom_label_sku"]),
  };
}

export function normalizeListingUploadRow(
  row: ListingRow,
  options?: NormalizeOptions,
): ListingUploadInput {
  return coerceListingUploadInput(readListingUploadRowDraft(row), options?.templateDefaults, {
    rowIndex: options?.rowIndex,
  });
}

export function parseListingUploadWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json<ListingRow>(workbook.Sheets[sheetName], {
    defval: "",
  });
}
