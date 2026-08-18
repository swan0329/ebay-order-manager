import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import * as XLSX from "xlsx";
import { z } from "zod";
import { parseCsvObjects, toCsv } from "@/lib/csv";
import {
  normalizeProductStatus,
  productStatuses,
  type ProductStatus,
} from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export { normalizeProductStatus, productStatusLabel, productStatuses } from "@/lib/product-status";

export function productOrderBy(
  sort?: string | null,
): Prisma.ProductOrderByWithRelationInput[] {
  if (sort === "pocamarket_oldest") {
    return [
      { pocamarketSyncedAt: { sort: "asc", nulls: "last" } },
      { sku: "asc" },
    ];
  }
  if (sort === "sku") {
    return [{ sku: "asc" }];
  }
  return [
    { pocamarketSyncedAt: { sort: "desc", nulls: "last" } },
    { sku: "asc" },
  ];
}

const productStatusSchema = z.preprocess(
  (value) => normalizeProductStatus(value),
  z.enum(productStatuses),
);

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

const preservablePocamarketId = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => {
    if (value === null || value === "") return null;
    return String(value).trim();
  })
  .refine(
    (value) => value === null || /^\d+$/.test(value),
    "포카마켓 상품번호는 숫자만 입력해 주세요.",
  )
  .optional();

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

// Like nullableDecimal, but an ABSENT key leaves the field unchanged (undefined)
// instead of nulling it — so callers that don't send ebayPrice (full edit form,
// CSV import) never wipe a USD price the user typed in the quick-edit table.
const preservableDecimal = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => {
    if (value === null || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  })
  .refine((value) => value === null || !Number.isNaN(value), "숫자 값을 입력해 주세요.")
  .optional();

export const productInputSchema = z.object({
  sku: z.string().trim().min(1, "SKU는 필수입니다.").max(120),
  pocamarketId: preservablePocamarketId,
  internalCode: nullableText,
  productName: z.string().trim().min(1, "상품명은 필수입니다.").max(240),
  optionName: nullableText,
  category: nullableText,
  brand: nullableText,
  costPrice: nullableDecimal,
  salePrice: nullableDecimal,
  ebayPrice: preservableDecimal,
  stockQuantity: intValue.refine((value) => value >= 0, "재고는 음수가 될 수 없습니다."),
  safetyStock: intValue.refine((value) => value >= 0, "안전재고는 음수가 될 수 없습니다."),
  location: nullableText,
  memo: nullableText,
  imageUrl: nullableText,
  status: productStatusSchema.default("unlisted"),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const bulkProductUpdateSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, "상품을 하나 이상 선택해 주세요.").max(5000),
    status: productStatusSchema.optional(),
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

export const bulkProductDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one product.").max(5000),
});

export type BulkProductDeleteInput = z.infer<typeof bulkProductDeleteSchema>;

function statusForStock(status: ProductStatus, stockQuantity: number) {
  if (stockQuantity <= 0) {
    return "sold_out";
  }

  if (status === "active") {
    return "active";
  }

  return "unlisted";
}

export function productData(input: ProductInput) {
  return {
    sku: input.sku,
    pocamarketId: input.pocamarketId,
    internalCode: input.internalCode,
    productName: input.productName,
    optionName: input.optionName,
    category: input.category,
    brand: input.brand,
    costPrice: input.costPrice,
    salePrice: input.salePrice,
    ebayPrice: input.ebayPrice,
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
  group?: string | null;
  member?: string | null;
  album?: string | null;
  version?: string | null;
  freshness?: string | null;
  upload?: string | null;
}): Prisma.ProductWhereInput {
  const q = params.q?.trim();
  const group = params.group?.trim();
  const member = params.member?.trim();
  const album = params.album?.trim();
  const version = params.version?.trim();
  const where: Prisma.ProductWhereInput = {};
  const and: Prisma.ProductWhereInput[] = [];

  if (params.status && params.status !== "all") {
    const status = normalizeProductStatus(params.status);
    if (status === "unlisted") {
      and.push({ OR: [{ status: "unlisted" }, { status: "inactive" }] });
    } else {
      where.status = status;
    }
  }

  if (params.stock === "sold_out") {
    and.push({
      stockQuantity: { lte: 0 },
    });
  }

  if (params.stock === "in_stock" || params.stock === "low") {
    and.push({
      stockQuantity: { gt: 0 },
    });
  }

  if (params.freshness === "never") {
    and.push({ pocamarketSyncedAt: null });
  } else if (params.freshness === "older_24h") {
    and.push({
      OR: [
        { pocamarketSyncedAt: null },
        { pocamarketSyncedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    });
  } else if (params.freshness === "older_7d") {
    and.push({
      OR: [
        { pocamarketSyncedAt: null },
        { pocamarketSyncedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    });
  }

  if (params.upload === "uploaded") {
    and.push({ ebayItemId: { not: null } });
  } else if (params.upload === "not_uploaded") {
    and.push({ ebayItemId: null });
  }

  if (group) {
    and.push({ brand: { startsWith: group, mode: "insensitive" } });
  }

  if (member) {
    and.push({ optionName: { startsWith: member, mode: "insensitive" } });
  }

  if (album) {
    and.push({ category: { contains: album, mode: "insensitive" } });
  }

  if (version) {
    and.push({
      OR: [
        { productName: { contains: version, mode: "insensitive" } },
        { memo: { contains: version, mode: "insensitive" } },
      ],
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
  const status = normalizeProductStatus(product.status);

  if (status === "unlisted") {
    return "미등록";
  }

  if (status === "sold_out") {
    return "품절";
  }

  if (product.stockQuantity <= 0) {
    return "품절";
  }

  if (product.stockQuantity <= product.safetyStock) {
    return "재고부족";
  }

  return "정상";
}

export function matchesProductStockFilter(
  product: {
    stockQuantity: number;
    safetyStock: number;
    status?: string | null;
    pocamarketAvailableCount?: number | null;
    pocamarketSyncedAt?: Date | string | null;
  },
  stock?: string | null,
) {
  if (!stock || stock === "all") {
    return true;
  }

  if (stock === "sold_out") {
    return product.stockQuantity <= 0;
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
  if (input.status !== undefined) {
    stockData.status = statusForStock(input.status, stockQuantity);
  }

  await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: stockData,
  });

  if (input.status === undefined) {
    if (stockQuantity <= 0) {
      await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { status: "sold_out" },
      });
    } else {
      await prisma.product.updateMany({
        where: { id: { in: productIds }, status: { not: "active" } },
        data: { status: "unlisted" },
      });
    }
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

export async function bulkDeleteProducts(input: BulkProductDeleteInput) {
  const ids = [...new Set(input.ids)];
  const existingCount = await prisma.product.count({
    where: { id: { in: ids } },
  });

  if (!existingCount) {
    throw new Error("No matching products found.");
  }

  const result = await prisma.product.deleteMany({
    where: { id: { in: ids } },
  });

  return {
    deleted: result.count,
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
  const pocamarketId =
    rowText(row, [
      "pocamarket_id",
      "pocamarketId",
      "포카마켓 상품번호",
      "포카마켓 카드 ID",
    ]) || (/^\d+$/.test(sku) ? sku : undefined);
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
    status
      ? normalizeProductStatus(status)
      : Number.isFinite(stockNumber) && stockNumber <= 0
        ? "sold_out"
        : "unlisted";
  const normalizedStockQuantity = Number.isFinite(stockNumber) ? stockNumber : 0;

  return {
    sku,
    pocamarketId,
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
    status: statusForStock(normalizedStatus, normalizedStockQuantity),
  };
}

/**
 * 같은 카드인지 판단하는 열쇠. 그룹·앨범·멤버·상품명이 모두 같으면 같은 카드다.
 *
 * 업로드는 SKU로만 중복을 걸렀다. 그래서 같은 카드가 SKU만 다른 여러 줄로 들어오면
 * 상품이 그 수만큼 만들어졌고, 재고가 그 줄들에 흩어져 주문은 그중 하나에만 붙었다.
 * 한 카드가 서른여섯 개 상품까지 쪼개진 적이 있다.
 */
export function productCardKey(input: {
  brand?: string | null;
  category?: string | null;
  optionName?: string | null;
  productName?: string | null;
}) {
  const part = (value?: string | null) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/\s+/g, " ")
      .trim();
  const pieces = [
    part(input.brand),
    part(input.category),
    part(input.optionName),
    part(input.productName),
  ];
  // 판단할 근거가 없으면 막지 않는다. 잘못 막는 것이 더 나쁘다.
  return pieces.some(Boolean) ? pieces.join("") : null;
}

export type DuplicateCardSkip = {
  sku: string;
  productName: string;
  existingSku: string;
};

/**
 * 새로 만들 상품 중 이미 같은 카드가 있는 것을 골라낸다.
 *
 * 이미 있는 SKU를 갱신하는 것은 그대로 두고, 새 상품을 만들 때만 본다. 재고를 말없이
 * 합치지 않고 만들기를 건너뛰기만 하는 이유는, 업로드 파일의 수량이 우리 보유량인지
 * 판매자 목록 수량인지 알 수 없기 때문이다. 사람이 보고 정해야 한다.
 */
async function findDuplicateCardSkips(
  newProducts: Array<Pick<ProductInput, "sku" | "brand" | "category" | "optionName" | "productName">>,
) {
  const skips = new Map<string, DuplicateCardSkip>();
  if (!newProducts.length) return skips;

  const names = [
    ...new Set(
      newProducts
        .map((product) => String(product.productName ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const existing = names.length
    ? (
        await Promise.all(
          chunkItems(names, 500).map((chunk) =>
            prisma.product.findMany({
              where: { productName: { in: chunk } },
              select: {
                sku: true,
                brand: true,
                category: true,
                optionName: true,
                productName: true,
              },
            }),
          ),
        )
      ).flat()
    : [];

  const claimed = new Map<string, string>();
  for (const product of existing) {
    const key = productCardKey(product);
    if (key && !claimed.has(key)) claimed.set(key, product.sku);
  }

  for (const product of newProducts) {
    const key = productCardKey(product);
    if (!key) continue;
    const owner = claimed.get(key);
    if (owner && owner !== product.sku) {
      skips.set(product.sku, {
        sku: product.sku,
        productName: String(product.productName ?? ""),
        existingSku: owner,
      });
      continue;
    }
    // 같은 파일 안에서 뒤따라오는 같은 카드도 막는다.
    if (!owner) claimed.set(key, product.sku);
  }

  return skips;
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

    return { outcome: "updated" as const };
  }

  // 새로 만들기 전에 같은 카드가 이미 있는지 본다. 있으면 만들지 않는다.
  const duplicate = (await findDuplicateCardSkips([input])).get(input.sku);
  if (duplicate) {
    return { outcome: "duplicate_card" as const, skip: duplicate };
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

  return { outcome: "created" as const };
}

export async function importProductsRows(
  rows: ProductImportRow[],
  createdBy?: string | null,
) {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const duplicateCards: DuplicateCardSkip[] = [];

  for (const [index, row] of rows.entries()) {
    const parsed = productInputSchema.safeParse(normalizeProductImportRow(row));

    if (!parsed.success) {
      errors.push(`${index + 2}행: ${parsed.error.issues[0]?.message ?? "입력 오류"}`);
      continue;
    }

    const result = await saveProductImport(parsed.data, createdBy);

    if (result.outcome === "duplicate_card") {
      duplicateCards.push(result.skip);
      continue;
    }

    if (result.outcome === "updated") {
      updated += 1;
    } else {
      created += 1;
    }
  }

  return { created, updated, errors, duplicateCards };
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
      status: parsed.data.status,
    });
  }

  const values = [...products.values()];

  if (!values.length) {
    return { created: 0, updated: 0, errors, duplicateCards: [] as DuplicateCardSkip[] };
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

  // 이미 같은 카드가 있는데 SKU만 다른 줄은 새로 만들지 않는다. 만들면 재고가
  // 그 줄로 흩어져 주문이 엉뚱한 쪽에 붙는다.
  const duplicateSkips = await findDuplicateCardSkips(
    values.filter((product) => !existingSkus.has(product.sku)),
  );
  const importable = values.filter((product) => !duplicateSkips.has(product.sku));

  if (!importable.length) {
    return {
      created: 0,
      updated: 0,
      errors,
      duplicateCards: [...duplicateSkips.values()],
    };
  }

  const created = importable.filter((product) => !existingSkus.has(product.sku)).length;
  const updated = importable.length - created;

  for (const chunk of chunkItems(importable, 500)) {
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

  const existingMovements = importable
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

  const createdWithStock = importable.filter(
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

  return {
    created,
    updated,
    errors,
    duplicateCards: [...duplicateSkips.values()],
  };
}

export async function importProductsCsv(text: string, createdBy?: string | null) {
  return importProductsRowsFastWithMovements(parseCsvObjects(text), createdBy);
}

export async function importProductsExcel(buffer: Buffer, createdBy?: string | null) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return {
      created: 0,
      updated: 0,
      errors: ["엑셀 시트를 찾을 수 없습니다."],
      duplicateCards: [] as DuplicateCardSkip[],
    };
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
