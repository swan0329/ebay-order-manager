import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import * as XLSX from "xlsx";
import { z } from "zod";
import { parseCsvObjects, toCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";

export const productStatuses = ["active", "inactive", "sold_out"] as const;

const nullableText = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((value) => {
    const text =
      typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
    return text ? text : null;
  });

const nullableDecimal = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  })
  .refine((value) => value === null || !Number.isNaN(value), "숫자 값을 입력해 주세요.");

const intValue = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return 0;
    }

    return Number(value);
  })
  .refine((value) => Number.isInteger(value), "정수를 입력해 주세요.");

const optionalNonNegativeInt = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }

    return Number(value);
  })
  .refine(
    (value) => value === undefined || (Number.isInteger(value) && value >= 0),
    "0 이상의 정수를 입력해 주세요.",
  );

const optionalNonNegativeDecimal = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }

    return Number(value);
  })
  .refine(
    (value) => value === undefined || (Number.isFinite(value) && value >= 0),
    "0 이상의 숫자를 입력해 주세요.",
  );

export const productInputSchema = z.object({
  sku: z.string().trim().min(1, "SKU는 필수입니다.").max(120),
  internalCode: nullableText,
  productName: z.string().trim().min(1, "상품명은 필수입니다.").max(240),
  optionName: nullableText,
  category: nullableText,
  brand: nullableText,
  costPrice: nullableDecimal,
  salePrice: nullableDecimal,
  stockQuantity: intValue.refine((value) => value >= 0, "재고는 음수가 될 수 없습니다."),
  safetyStock: intValue.refine((value) => value >= 0, "안전재고는 음수가 될 수 없습니다."),
  location: nullableText,
  memo: nullableText,
  imageUrl: nullableText,
  status: z.enum(productStatuses).default("active"),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const bulkProductUpdateSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, "상품을 하나 이상 선택해 주세요.").max(5000),
    status: z.enum(productStatuses).optional(),
    stockQuantity: optionalNonNegativeInt,
    salePrice: optionalNonNegativeDecimal,
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.stockQuantity !== undefined ||
      value.salePrice !== undefined,
    "변경할 값을 하나 이상 입력해 주세요.",
  );

export type BulkProductUpdateInput = z.infer<typeof bulkProductUpdateSchema>;

function statusForStock(status: (typeof productStatuses)[number], stockQuantity: number) {
  if (stockQuantity <= 0) {
    return "sold_out";
  }

  return status;
}

export function productData(input: ProductInput) {
  return {
    sku: input.sku,
    internalCode: input.internalCode,
    productName: input.productName,
    optionName: input.optionName,
    category: input.category,
    brand: input.brand,
    costPrice: input.costPrice,
    salePrice: input.salePrice,
    stockQuantity: input.stockQuantity,
    safetyStock: input.safetyStock,
    location: input.location,
    memo: input.memo,
    imageUrl: input.imageUrl,
    status: statusForStock(input.status, input.stockQuantity),
  };
}

export function productWhere(params: {
  q?: string | null;
  status?: string | null;
  stock?: string | null;
}): Prisma.ProductWhereInput {
  const q = params.q?.trim();
  const where: Prisma.ProductWhereInput = {};
  const and: Prisma.ProductWhereInput[] = [];

  if (params.status && params.status !== "all") {
    where.status = params.status;
  }

  if (params.stock === "sold_out") {
    and.push({
      OR: [{ stockQuantity: { lte: 0 } }, { status: "sold_out" }],
    });
  }

  if (params.stock === "in_stock" || params.stock === "low") {
    and.push({
      stockQuantity: { gt: 0 },
    });
  }

  if (q) {
    and.push({
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { productName: { contains: q, mode: "insensitive" } },
        { internalCode: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { optionName: { contains: q, mode: "insensitive" } },
        { memo: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (and.length) {
    where.AND = and;
  }

  return where;
}

export function productStockLabel(product: {
  stockQuantity: number;
  safetyStock: number;
  status: string;
}) {
  if (product.status === "inactive") {
    return "비활성";
  }

  if (product.stockQuantity <= 0 || product.status === "sold_out") {
    return "품절";
  }

  if (product.stockQuantity <= product.safetyStock) {
    return "재고부족";
  }

  return "정상";
}

export function matchesProductStockFilter(
  product: { stockQuantity: number; safetyStock: number; status?: string | null },
  stock?: string | null,
) {
  if (!stock || stock === "all") {
    return true;
  }

  if (stock === "sold_out") {
    return product.stockQuantity <= 0 || product.status === "sold_out";
  }

  if (stock === "in_stock" || stock === "low") {
    return product.stockQuantity > 0;
  }

  return true;
}

export async function createProduct(input: ProductInput) {
  return prisma.product.create({ data: productData(input) });
}

export async function updateProduct(
  id: string,
  input: ProductInput,
  createdBy?: string | null,
) {
  const current = await prisma.product.findUnique({
    where: { id },
    select: { stockQuantity: true },
  });

  if (!current) {
    throw new Error("상품을 찾을 수 없습니다.");
  }

  const product = await prisma.product.update({
    where: { id },
    data: productData(input),
  });

  if (current.stockQuantity !== input.stockQuantity) {
    await prisma.inventoryMovement.create({
      data: {
        productId: id,
        type: "ADJUST",
        quantity: Math.abs(input.stockQuantity - current.stockQuantity),
        beforeQuantity: current.stockQuantity,
        afterQuantity: input.stockQuantity,
        reason: "재고관리 목록 수정",
        createdBy,
      },
    });
  }

  return product;
}

export async function bulkUpdateProducts(
  input: BulkProductUpdateInput,
  createdBy?: string | null,
) {
  const ids = [...new Set(input.ids)];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, stockQuantity: true, status: true },
  });

  if (!products.length) {
    throw new Error("선택한 상품을 찾을 수 없습니다.");
  }

  const productIds = products.map((product) => product.id);
  const baseData: Prisma.ProductUpdateManyMutationInput = {};

  if (input.status !== undefined) {
    baseData.status = input.status;
  }

  if (input.salePrice !== undefined) {
    baseData.salePrice = input.salePrice;
  }

  if (input.stockQuantity === undefined) {
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: baseData,
    });

    return { updated: products.length, stockMovements: 0 };
  }

  const stockQuantity = input.stockQuantity;
  const stockData: Prisma.ProductUpdateManyMutationInput = {
    ...baseData,
    stockQuantity,
  };

  if (input.status === undefined && stockQuantity > 0) {
    const soldOutIds = products
      .filter((product) => product.status === "sold_out")
      .map((product) => product.id);
    const unchangedStatusIds = products
      .filter((product) => product.status !== "sold_out")
      .map((product) => product.id);

    if (soldOutIds.length) {
      await prisma.product.updateMany({
        where: { id: { in: soldOutIds } },
        data: { ...stockData, status: "active" },
      });
    }

    if (unchangedStatusIds.length) {
      await prisma.product.updateMany({
        where: { id: { in: unchangedStatusIds } },
        data: stockData,
      });
    }
  } else {
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: {
        ...stockData,
        status: input.status ?? "sold_out",
      },
    });
  }

  const changedStockProducts = products.filter(
    (product) => product.stockQuantity !== stockQuantity,
  );

  if (changedStockProducts.length) {
    await prisma.inventoryMovement.createMany({
      data: changedStockProducts.map((product) => ({
        productId: product.id,
        type: "ADJUST",
        quantity: Math.abs(stockQuantity - product.stockQuantity),
        beforeQuantity: product.stockQuantity,
        afterQuantity: stockQuantity,
        reason: "상품 목록 일괄 수정",
        createdBy,
      })),
    });
  }

  return {
    updated: products.length,
    stockMovements: changedStockProducts.length,
  };
}

export type ProductImportRow = Record<string, unknown>;

function rowValue(row: ProductImportRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function rowText(row: ProductImportRow, keys: string[]) {
  const value = rowValue(row, keys);
  return value === "" ? "" : String(value).trim();
}

export function normalizeProductImportRow(row: ProductImportRow) {
  const sku = rowText(row, ["sku", "SKU", "상품번호", "상품 번호"]);
  const groupName = rowText(row, ["그룹명", "brand", "브랜드"]);
  const albumName = rowText(row, ["앨범명", "category", "카테고리"]);
  const originalAlbumName = rowText(row, ["원본 앨범명"]);
  const memberName = rowText(row, ["멤버", "option_name", "옵션명"]);
  const productName =
    rowText(row, ["product_name", "상품명"]) ||
    [groupName, albumName || originalAlbumName, memberName]
      .filter(Boolean)
      .join(" ");
  const stockQuantity = rowValue(row, ["stock_quantity", "재고"]);
  const status = rowText(row, ["status", "상태"]);
  const stockNumber = Number(stockQuantity || 0);
  const normalizedStatus =
    Number.isFinite(stockNumber) && stockNumber <= 0
      ? "sold_out"
      : status || "active";

  return {
    sku,
    internalCode: rowValue(row, ["internal_code", "내부코드", "상품번호"]),
    productName,
    optionName: rowValue(row, ["option_name", "옵션명", "멤버"]),
    category: rowValue(row, ["category", "카테고리", "앨범명", "원본 앨범명"]),
    brand: rowValue(row, ["brand", "브랜드", "그룹명"]),
    costPrice: rowValue(row, ["cost_price", "원가"]),
    salePrice: rowValue(row, ["sale_price", "판매가", "포카마켓 가격"]),
    stockQuantity,
    safetyStock: rowValue(row, ["safety_stock", "안전재고"]),
    location: rowValue(row, ["location", "위치"]),
    memo: rowValue(row, ["memo", "메모", "원본 앨범명"]),
    imageUrl: rowValue(row, ["image_url", "이미지", "이미지 URL", "포카마켓 이미지"]),
    status: normalizedStatus,
  };
}

async function saveProductImport(input: ProductInput, createdBy?: string | null) {
  const data = productData(input);
  const existing = await prisma.product.findUnique({
    where: { sku: input.sku },
    select: { id: true, stockQuantity: true },
  });

  if (existing) {
    await prisma.product.update({ where: { id: existing.id }, data });

    if (existing.stockQuantity !== input.stockQuantity) {
      await prisma.inventoryMovement.create({
        data: {
          productId: existing.id,
          type: "ADJUST",
          quantity: Math.abs(input.stockQuantity - existing.stockQuantity),
          beforeQuantity: existing.stockQuantity,
          afterQuantity: input.stockQuantity,
          reason: "상품 업로드",
          createdBy,
        },
      });
    }

    return "updated" as const;
  }

  const product = await prisma.product.create({ data });

  if (input.stockQuantity > 0) {
    await prisma.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "IN",
        quantity: input.stockQuantity,
        beforeQuantity: 0,
        afterQuantity: input.stockQuantity,
        reason: "상품 업로드",
        createdBy,
      },
    });
  }

  return "created" as const;
}

export async function importProductsRows(
  rows: ProductImportRow[],
  createdBy?: string | null,
) {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const parsed = productInputSchema.safeParse(normalizeProductImportRow(row));

    if (!parsed.success) {
      errors.push(`${index + 2}행: ${parsed.error.issues[0]?.message ?? "입력 오류"}`);
      continue;
    }

    const result = await saveProductImport(parsed.data, createdBy);

    if (result === "updated") {
      updated += 1;
    } else {
      created += 1;
    }
  }

  return { created, updated, errors };
}

export async function importProductsRowsFast(
  rows: ProductImportRow[],
  createdBy?: string | null,
) {
  return importProductsRowsFastWithMovements(rows, createdBy);
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function importProductsRowsFastWithMovements(
  rows: ProductImportRow[],
  createdBy?: string | null,
) {
  const products = new Map<string, ProductInput>();
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const parsed = productInputSchema.safeParse(normalizeProductImportRow(row));

    if (!parsed.success) {
      errors.push(`${index + 2}행: ${parsed.error.issues[0]?.message ?? "입력 오류"}`);
      continue;
    }

    products.set(parsed.data.sku, {
      ...parsed.data,
      status: statusForStock(parsed.data.status, parsed.data.stockQuantity),
    });
  }

  const values = [...products.values()];

  if (!values.length) {
    return { created: 0, updated: 0, errors };
  }

  const existingProducts = (
    await Promise.all(
      chunkItems(values, 1000).map((chunk) =>
        prisma.product.findMany({
          where: { sku: { in: chunk.map((product) => product.sku) } },
          select: { id: true, sku: true, stockQuantity: true },
        }),
      ),
    )
  ).flat();
  const existingSkus = new Set(existingProducts.map((product) => product.sku));
  const existingBySku = new Map(
    existingProducts.map((product) => [product.sku, product]),
  );
  const created = values.filter((product) => !existingSkus.has(product.sku)).length;
  const updated = values.length - created;

  for (const chunk of chunkItems(values, 500)) {
    await prisma.$executeRaw`
      INSERT INTO "products" (
        "id",
        "sku",
        "internal_code",
        "product_name",
        "option_name",
        "category",
        "brand",
        "cost_price",
        "sale_price",
        "stock_quantity",
        "safety_stock",
        "location",
        "memo",
        "image_url",
        "status",
        "created_at",
        "updated_at"
      )
      VALUES ${Prisma.join(
        chunk.map(
          (product) => Prisma.sql`(
            ${randomUUID()},
            ${product.sku},
            ${product.internalCode},
            ${product.productName},
            ${product.optionName},
            ${product.category},
            ${product.brand},
            ${product.costPrice},
            ${product.salePrice},
            ${product.stockQuantity},
            ${product.safetyStock},
            ${product.location},
            ${product.memo},
            ${product.imageUrl},
            ${product.status},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )`,
        ),
      )}
      ON CONFLICT ("sku") DO UPDATE SET
        "internal_code" = EXCLUDED."internal_code",
        "product_name" = EXCLUDED."product_name",
        "option_name" = EXCLUDED."option_name",
        "category" = EXCLUDED."category",
        "brand" = EXCLUDED."brand",
        "cost_price" = EXCLUDED."cost_price",
        "sale_price" = EXCLUDED."sale_price",
        "stock_quantity" = EXCLUDED."stock_quantity",
        "safety_stock" = EXCLUDED."safety_stock",
        "location" = EXCLUDED."location",
        "memo" = EXCLUDED."memo",
        "image_url" = EXCLUDED."image_url",
        "status" = EXCLUDED."status",
        "updated_at" = CURRENT_TIMESTAMP
    `;
  }

  const existingMovements = values
    .map((product) => {
      const existing = existingBySku.get(product.sku);

      if (!existing || existing.stockQuantity === product.stockQuantity) {
        return null;
      }

      return {
        productId: existing.id,
        type: "ADJUST",
        quantity: Math.abs(product.stockQuantity - existing.stockQuantity),
        beforeQuantity: existing.stockQuantity,
        afterQuantity: product.stockQuantity,
        reason: "상품 업로드",
        createdBy,
      };
    })
    .filter((movement) => movement !== null);

  const createdWithStock = values.filter(
    (product) => !existingSkus.has(product.sku) && product.stockQuantity > 0,
  );

  if (createdWithStock.length) {
    const createdProducts = (
      await Promise.all(
        chunkItems(createdWithStock, 1000).map((chunk) =>
          prisma.product.findMany({
            where: { sku: { in: chunk.map((product) => product.sku) } },
            select: { id: true, sku: true },
          }),
        ),
      )
    ).flat();
    const createdBySku = new Map(
      createdProducts.map((product) => [product.sku, product]),
    );

    for (const product of createdWithStock) {
      const createdProduct = createdBySku.get(product.sku);

      if (!createdProduct) {
        continue;
      }

      existingMovements.push({
        productId: createdProduct.id,
        type: "IN",
        quantity: product.stockQuantity,
        beforeQuantity: 0,
        afterQuantity: product.stockQuantity,
        reason: "상품 업로드",
        createdBy,
      });
    }
  }

  for (const chunk of chunkItems(existingMovements, 1000)) {
    await prisma.inventoryMovement.createMany({ data: chunk });
  }

  return { created, updated, errors };
}

export async function importProductsCsv(text: string, createdBy?: string | null) {
  return importProductsRowsFastWithMovements(parseCsvObjects(text), createdBy);
}

export async function importProductsExcel(buffer: Buffer, createdBy?: string | null) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return { created: 0, updated: 0, errors: ["엑셀 시트를 찾을 수 없습니다."] };
  }

  const rows = XLSX.utils.sheet_to_json<ProductImportRow>(
    workbook.Sheets[sheetName],
    { defval: "" },
  );

  return importProductsRowsFastWithMovements(rows, createdBy);
}

export async function productsCsv(
  where: Prisma.ProductWhereInput = {},
  stock?: string | null,
) {
  const products = (
    await prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    })
  ).filter((product) => matchesProductStockFilter(product, stock));
  const header = [
    "sku",
    "internal_code",
    "product_name",
    "option_name",
    "category",
    "brand",
    "cost_price",
    "sale_price",
    "stock_quantity",
    "safety_stock",
    "location",
    "memo",
    "image_url",
    "status",
  ];
  const rows = products.map((product) => [
    product.sku,
    product.internalCode,
    product.productName,
    product.optionName,
    product.category,
    product.brand,
    product.costPrice?.toString(),
    product.salePrice?.toString(),
    product.stockQuantity,
    product.safetyStock,
    product.location,
    product.memo,
    product.imageUrl,
    product.status,
  ]);

  return toCsv([header, ...rows]);
}
