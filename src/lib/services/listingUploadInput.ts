import * as XLSX from "xlsx";
import { z } from "zod";
import type { ListingUploadInput } from "@/lib/services/inventoryService";

type ListingRow = Record<string, unknown>;

function r2PublicBaseUrl() {
  return (
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

export function resolveListingImageUrl(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const baseUrl = r2PublicBaseUrl();

  if (!baseUrl) {
    return value;
  }

  return `${baseUrl}/${value.replace(/^\/+/, "")}`;
}

export function resolveListingImageUrls(value: string, fallback?: string | null) {
  const values = parseImageList(value || fallback || "");
  return [...new Set(values.map(resolveListingImageUrl))];
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
  shippingProfile: z.string().trim().min(1),
  returnProfile: z.string().trim().min(1),
  paymentProfile: z.string().trim().optional().nullable(),
  merchantLocationKey: z.string().trim().optional().nullable(),
  marketplaceId: z.string().trim().optional().nullable(),
  currency: z.string().trim().optional().nullable(),
});

export function normalizeListingUploadRow(row: ListingRow): ListingUploadInput {
  const title =
    rowValue(row, ["title", "ebay_title", "product_name", "상품명", "제품명"]) ||
    [
      rowValue(row, ["brand", "그룹명"]),
      rowValue(row, ["category", "앨범명"]),
      rowValue(row, ["option_name", "멤버"]),
    ]
      .filter(Boolean)
      .join(" ");
  const descriptionHtml =
    rowValue(row, ["description_html", "description", "상세설명", "설명"]) ||
    `<p>${title}</p>`;
  const imageUrls = resolveListingImageUrls(
    rowValue(row, [
      "image_urls",
      "image_url",
      "images",
      "이미지 URL",
      "이미지",
      "포카마켓 이미지",
      "r2_key",
      "r2_keys",
    ]),
  );

  return listingUploadSchema.parse({
    sku: rowValue(row, ["sku", "SKU", "상품번호", "상품 번호"]),
    title,
    descriptionHtml,
    price: rowValue(row, ["price", "ebay_price", "sale_price", "판매가", "포카마켓 가격"]),
    quantity: rowValue(row, ["quantity", "stock_quantity", "재고", "수량"]),
    imageUrls,
    categoryId: rowValue(row, ["category_id", "ebay_category_id", "eBay 카테고리 ID"]),
    condition: rowValue(row, ["condition", "ebay_condition", "상태"]) || "NEW",
    shippingProfile: rowValue(row, [
      "shipping_profile",
      "fulfillment_policy_id",
      "shipping_policy_id",
      "배송 정책",
    ]),
    returnProfile: rowValue(row, ["return_profile", "return_policy_id", "반품 정책"]),
    paymentProfile:
      rowValue(row, ["payment_profile", "payment_policy_id", "결제 정책"]) || null,
    merchantLocationKey:
      rowValue(row, ["merchant_location_key", "location_key", "출고지"]) || null,
    marketplaceId: rowValue(row, ["marketplace_id", "marketplace"]) || "EBAY_US",
    currency: rowValue(row, ["currency", "통화"]) || "USD",
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
