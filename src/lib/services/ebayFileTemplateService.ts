import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import {
  buildEbayListingCategoryId,
  buildEbayListingCategoryName,
  buildEbayListingConditionId,
  buildEbayListingDescription,
  buildEbayListingImageUrls,
  buildEbayListingItemSpecifics,
  buildEbayListingPrice,
  buildEbayListingTitle,
  type EbayListingFieldProduct,
} from "@/lib/ebay-listing-fields";

export type EbayFileTemplate = {
  columns: string[];
  defaults: Record<string, string>;
  isSellerHubFormat: boolean;
};

// Columns always filled from product data — never use template default value
const PRODUCT_COLUMN_KEYS = new Set([
  "action",
  "*action",
  "customlabel",
  "*customlabel",
  "custom label (sku)",
  "title",
  "*title",
  "description",
  "*description",
  "picurl",
  "*picurl",
  "pictureurl",
  "*pictureurl",
  "item photo url",
  "buyitnowprice",
  "*buyitnowprice",
  "buy it now price",
  "startprice",
  "*startprice",
  "start price",
  "quantity",
  "*quantity",
  "category",
  "*category",
  "category id",
  "category name",
  "conditionid",
  "*conditionid",
  "condition id",
  "*condition id",
  "duration",
  "*duration",
  "format",
  "*format",
  "c:artist",
  "c:brand",
  "c:country/region of manufacture",
  "c:featured person/artist",
  "c:franchise",
  "c:genre",
  "c:original/reproduction",
  "c:set",
  "c:type",
]);

export function isProductColumn(column: string) {
  const col = column.toLowerCase();
  // *Action(SiteID=US|...) — any variant
  if (col.startsWith("*action") || col === "action") return true;
  return PRODUCT_COLUMN_KEYS.has(col);
}

export function getProductValue(
  column: string,
  product: EbayListingFieldProduct,
  templateDefault: string,
  baseUrl?: string | null,
): string {
  const col = column.toLowerCase();

  // Action — handles *Action(SiteID=US|Country=US|Currency=USD|Version=...)
  if (col.startsWith("*action") || col === "action") return "Add";

  // Custom label / SKU
  if (
    col === "customlabel" ||
    col === "*customlabel" ||
    col === "custom label (sku)"
  ) {
    return product.sku;
  }

  // Title (max 80 chars)
  if (col === "title" || col === "*title") {
    return buildEbayListingTitle(product);
  }

  // Description
  if (col === "description" || col === "*description") {
    return buildEbayListingDescription(product);
  }

  // Picture URL — pipe-separated for multiple images
  if (
    col === "picurl" ||
    col === "*picurl" ||
    col === "pictureurl" ||
    col === "*pictureurl" ||
    col === "item photo url"
  ) {
    return buildEbayListingImageUrls(product, baseUrl).join("|");
  }

  // Price — Start price or Buy It Now price
  if (
    col === "buyitnowprice" ||
    col === "*buyitnowprice" ||
    col === "buy it now price" ||
    col === "startprice" ||
    col === "*startprice" ||
    col === "start price"
  ) {
    return buildEbayListingPrice(product);
  }

  // Quantity
  if (col === "quantity" || col === "*quantity") {
    return String(product.stockQuantity);
  }

  // Category — use product's eBay category if set
  if (col === "*category" || col === "category" || col === "category id") {
    return buildEbayListingCategoryId(product, templateDefault || undefined);
  }

  if (col === "category name") {
    return templateDefault || buildEbayListingCategoryName(product);
  }

  if (
    col === "conditionid" ||
    col === "*conditionid" ||
    col === "condition id" ||
    col === "*condition id"
  ) {
    return buildEbayListingConditionId(product, templateDefault || undefined);
  }

  // Format — always fixed price
  if (col === "format" || col === "*format") {
    return templateDefault || "FixedPrice";
  }

  // Duration — always GTC
  if (col === "duration" || col === "*duration") {
    return templateDefault || "GTC";
  }

  const itemSpecifics = buildEbayListingItemSpecifics(product);

  if (col === "c:brand") return itemSpecifics.Brand || templateDefault;
  if (col === "c:type") return itemSpecifics.Type || templateDefault;
  if (col === "c:artist") return itemSpecifics.Artist || templateDefault;
  if (col === "c:featured person/artist") {
    return itemSpecifics["Featured Person/Artist"] || templateDefault;
  }
  if (col === "c:franchise") return itemSpecifics.Franchise || templateDefault;
  if (col === "c:set") return itemSpecifics.Set || templateDefault;
  if (col === "c:genre") return itemSpecifics.Genre || templateDefault;
  if (col === "c:country/region of manufacture") {
    return itemSpecifics["Country/Region of Manufacture"] || templateDefault;
  }

  // Photocards are originals by default
  if (col === "c:original/reproduction") {
    return itemSpecifics["Original/Reproduction"] || templateDefault;
  }

  return templateDefault;
}

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "ebay_file_templates" (
      "user_id" TEXT PRIMARY KEY,
      "columns_json" TEXT NOT NULL,
      "defaults_json" TEXT NOT NULL,
      "is_seller_hub_format" BOOLEAN NOT NULL DEFAULT FALSE,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Add column if upgrading from older schema without the flag
  await prisma.$executeRaw`
    ALTER TABLE "ebay_file_templates"
    ADD COLUMN IF NOT EXISTS "is_seller_hub_format" BOOLEAN NOT NULL DEFAULT FALSE
  `;
}

export async function getEbayFileTemplate(
  userId: string,
): Promise<EbayFileTemplate | null> {
  await ensureTable();

  const rows = await prisma.$queryRaw<
    {
      columns_json: string;
      defaults_json: string;
      is_seller_hub_format: boolean;
    }[]
  >`
    SELECT "columns_json", "defaults_json", "is_seller_hub_format"
    FROM "ebay_file_templates"
    WHERE "user_id" = ${userId}
    LIMIT 1
  `;

  if (!rows[0]) return null;

  return {
    columns: JSON.parse(rows[0].columns_json) as string[],
    defaults: JSON.parse(rows[0].defaults_json) as Record<string, string>,
    isSellerHubFormat: rows[0].is_seller_hub_format,
  };
}

export async function saveEbayFileTemplate(
  userId: string,
  template: EbayFileTemplate,
): Promise<void> {
  await ensureTable();

  const columnsJson = JSON.stringify(template.columns);
  const defaultsJson = JSON.stringify(template.defaults);
  const isSellerHubFormat = template.isSellerHubFormat;

  await prisma.$executeRaw`
    INSERT INTO "ebay_file_templates" (
      "user_id", "columns_json", "defaults_json", "is_seller_hub_format", "updated_at"
    )
    VALUES (${userId}, ${columnsJson}, ${defaultsJson}, ${isSellerHubFormat}, NOW())
    ON CONFLICT ("user_id") DO UPDATE SET
      "columns_json" = EXCLUDED."columns_json",
      "defaults_json" = EXCLUDED."defaults_json",
      "is_seller_hub_format" = EXCLUDED."is_seller_hub_format",
      "updated_at" = NOW()
  `;
}

export async function deleteEbayFileTemplate(userId: string): Promise<void> {
  await ensureTable();
  await prisma.$executeRaw`
    DELETE FROM "ebay_file_templates" WHERE "user_id" = ${userId}
  `;
}

export function parseEbayTemplateCsv(buffer: ArrayBuffer): EbayFileTemplate {
  const workbook = XLSX.read(buffer, { type: "array" });

  // Prefer the "Listings" sheet (Seller Hub Reports format), fall back to first sheet
  const listingsSheetName =
    workbook.SheetNames.find((n) => n === "Listings") ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[listingsSheetName ?? ""];

  if (!sheet) {
    throw new Error("파일에서 시트를 찾을 수 없습니다.");
  }

  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  // Find the header row — first row with a recognizable eBay column name
  const ebayFieldPattern =
    /^\*|^C:|^action$|^title$|^description$|^category|^quantity$|picurl|customlabel|buyitnow|startprice|start price|item photo|format|duration|currency|condition|dispatch|shipping|returns|refund/i;

  const headerRowIndex = allRows.findIndex((row) =>
    row.some(
      (cell) => typeof cell === "string" && ebayFieldPattern.test(cell.trim()),
    ),
  );

  if (headerRowIndex === -1) {
    throw new Error(
      "eBay 파일교환 형식의 헤더를 찾을 수 없습니다. eBay 셀러허브에서 다운받은 템플릿 파일을 올려주세요.",
    );
  }

  const columns = allRows[headerRowIndex]
    .map((cell) => String(cell ?? "").trim())
    .filter(Boolean);

  if (columns.length === 0) {
    throw new Error("헤더 행에서 컬럼을 찾을 수 없습니다.");
  }

  // Detect Seller Hub Reports format (action column has parenthetical metadata)
  const isSellerHubFormat = columns[0]?.toLowerCase().startsWith("*action(") ?? false;

  // Find first data row after the header that has at least some values
  const firstDataRow = allRows
    .slice(headerRowIndex + 1)
    .find((row) => row.some((cell) => String(cell ?? "").trim()));

  const defaults: Record<string, string> = {};

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const value = String(firstDataRow?.[i] ?? "").trim();
    defaults[col] = isProductColumn(col) ? "" : value;
  }

  // For Seller Hub format: read business policies from the BusinessPolicy sheet
  if (isSellerHubFormat) {
    const bpSheet = workbook.Sheets["BusinessPolicy"];
    if (bpSheet) {
      const bpRows = XLSX.utils.sheet_to_json<string[]>(bpSheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      // Row 0: ["ShippingPolicyNames","ReturnPolicyNames","PaymentPolicyNames"]
      // Row 1+: policy name values
      if (bpRows.length > 1) {
        const shippingName = String(bpRows[1]?.[0] ?? "").trim();
        const returnName = String(bpRows[1]?.[1] ?? "").trim();
        const paymentName = String(bpRows[1]?.[2] ?? "").trim();

        if (shippingName) defaults["Shipping profile name"] = shippingName;
        if (returnName) defaults["Return profile name"] = returnName;
        if (paymentName) defaults["Payment profile name"] = paymentName;
      }
    }
  }

  return { columns, defaults, isSellerHubFormat };
}
