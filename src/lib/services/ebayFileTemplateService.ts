import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import type { Product } from "@/generated/prisma";

export type EbayFileTemplate = {
  columns: string[];
  defaults: Record<string, string>;
};

// Columns that are always filled from product data (not from template defaults)
const PRODUCT_COLUMN_KEYS = new Set([
  "action",
  "*action",
  "customlabel",
  "*customlabel",
  "title",
  "*title",
  "description",
  "*description",
  "picurl",
  "*picurl",
  "pictureurl",
  "*pictureurl",
  "buyitnowprice",
  "*buyitnowprice",
  "startprice",
  "*startprice",
  "quantity",
  "*quantity",
]);

export function isProductColumn(column: string) {
  return PRODUCT_COLUMN_KEYS.has(column.toLowerCase());
}

export function getProductValue(
  column: string,
  product: Product,
  templateDefault: string,
): string {
  const col = column.toLowerCase();

  if (col === "action" || col === "*action") return "Add";

  if (col === "customlabel" || col === "*customlabel") return product.sku;

  if (col === "title" || col === "*title") {
    return (product.ebayTitle ?? product.productName).slice(0, 80);
  }

  if (col === "description" || col === "*description") {
    return (
      product.descriptionHtml ??
      product.memo ??
      `<p>${product.productName}</p>`
    );
  }

  if (
    col === "picurl" ||
    col === "*picurl" ||
    col === "pictureurl" ||
    col === "*pictureurl"
  ) {
    return product.ebayImageUrls.length > 0
      ? product.ebayImageUrls.join("|")
      : (product.imageUrl ?? "");
  }

  if (
    col === "buyitnowprice" ||
    col === "*buyitnowprice" ||
    col === "startprice" ||
    col === "*startprice"
  ) {
    return (product.ebayPrice ?? product.salePrice)?.toFixed(2) ?? "";
  }

  if (col === "quantity" || col === "*quantity") {
    return String(product.stockQuantity);
  }

  // Category: use product's if set, otherwise keep template default
  if (col === "*category" || col === "category") {
    return product.ebayCategoryId ?? templateDefault;
  }

  // Brand item specific
  if (col === "c:brand") return product.brand ?? templateDefault;

  // Type item specific (member name)
  if (col === "c:type") return product.optionName ?? templateDefault;

  return templateDefault;
}

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "ebay_file_templates" (
      "user_id" TEXT PRIMARY KEY,
      "columns_json" TEXT NOT NULL,
      "defaults_json" TEXT NOT NULL,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function getEbayFileTemplate(
  userId: string,
): Promise<EbayFileTemplate | null> {
  await ensureTable();

  const rows = await prisma.$queryRaw<
    { columns_json: string; defaults_json: string }[]
  >`
    SELECT "columns_json", "defaults_json"
    FROM "ebay_file_templates"
    WHERE "user_id" = ${userId}
    LIMIT 1
  `;

  if (!rows[0]) return null;

  return {
    columns: JSON.parse(rows[0].columns_json) as string[],
    defaults: JSON.parse(rows[0].defaults_json) as Record<string, string>,
  };
}

export async function saveEbayFileTemplate(
  userId: string,
  template: EbayFileTemplate,
): Promise<void> {
  await ensureTable();

  const columnsJson = JSON.stringify(template.columns);
  const defaultsJson = JSON.stringify(template.defaults);

  await prisma.$executeRaw`
    INSERT INTO "ebay_file_templates" ("user_id", "columns_json", "defaults_json", "updated_at")
    VALUES (${userId}, ${columnsJson}, ${defaultsJson}, NOW())
    ON CONFLICT ("user_id") DO UPDATE SET
      "columns_json" = EXCLUDED."columns_json",
      "defaults_json" = EXCLUDED."defaults_json",
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
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    throw new Error("파일에서 시트를 찾을 수 없습니다.");
  }

  // Get all rows as arrays of strings
  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  // Find the header row — first row that has a cell looking like an eBay column
  // (contains "*", starts with "C:", or is a known eBay field name)
  const ebayFieldPattern =
    /^\*|^C:|^action$|^title$|^description$|^category$|^quantity$|picurl|customlabel|buyitnow|startprice|format|duration|currency|condition|dispatch|shipping|returns|refund/i;

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

  // Find the first data row after the header with at least some values
  const firstDataRow = allRows
    .slice(headerRowIndex + 1)
    .find((row) => row.some((cell) => String(cell ?? "").trim()));

  const defaults: Record<string, string> = {};

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const value = String(firstDataRow?.[i] ?? "").trim();
    // Don't save product-specific column defaults — they'll be overridden anyway
    defaults[col] = isProductColumn(col) ? "" : value;
  }

  return { columns, defaults };
}
