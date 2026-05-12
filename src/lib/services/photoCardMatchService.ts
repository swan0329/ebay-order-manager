import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

const defaultLimit = 50;
const maxLimit = 50;

export type PhotoCardCandidateFilters = {
  group?: string | null;
  member?: string | null;
  album?: string | null;
  version?: string | null;
  keyword?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type PhotoCardCandidate = {
  cardId: string;
  id: string;
  sku: string;
  title: string;
  groupName: string | null;
  memberName: string | null;
  albumName: string | null;
  versionName: string | null;
  existingImageUrl: string | null;
  currentImageUrl: string | null;
  stockQuantity: number;
  userImageRegistered: boolean;
  hasBackImage: boolean;
};

export type PhotoCardFacetOptions = {
  groups: string[];
  members: string[];
  albums: string[];
  versions: string[];
};

type PhotoCardCandidateRow = {
  cardId: string;
  sku: string;
  title: string;
  groupName: string | null;
  memberName: string | null;
  albumName: string | null;
  versionName: string | null;
  existingImageUrl: string | null;
  currentImageUrl: string | null;
  stockQuantity: number;
  userImageRegistered: boolean;
  hasBackImage: boolean;
};

type DistinctValueRow = {
  value: string | null;
};

export type ConfirmPhotoCardImageInput = {
  cardId: string;
  userFrontImageUrl: string;
  userBackImageUrl?: string | null;
  publicBaseUrl?: string | null;
};

export async function listPhotoCardCandidates(filters: PhotoCardCandidateFilters) {
  await ensurePhotoCardSearchSupport();

  const normalized = normalizePhotoCardCandidateFilters(filters);
  const clauses = candidateWhereClauses(normalized);
  const whereSql = clauses.length
    ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`
    : Prisma.empty;
  const orderSql = Prisma.join(candidateOrderClauses(normalized), ", ");
  const rows = await prisma.$queryRaw<PhotoCardCandidateRow[]>`
    SELECT
      "id" AS "cardId",
      "sku",
      "product_name" AS "title",
      "brand" AS "groupName",
      "option_name" AS "memberName",
      "category" AS "albumName",
      "product_name" AS "versionName",
      COALESCE("source_image_url", "image_url") AS "existingImageUrl",
      COALESCE("image_url", "source_image_url") AS "currentImageUrl",
      "stock_quantity" AS "stockQuantity",
      ("user_front_image_url" IS NOT NULL AND "user_front_image_url" <> '') AS "userImageRegistered",
      "has_back_image" AS "hasBackImage"
    FROM "products"
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${normalized.limit}
    OFFSET ${normalized.offset}
  `;
  const facets = await loadPhotoCardFacets(normalized);

  return {
    candidates: rows.map(toPhotoCardCandidate),
    facets,
    paging: {
      limit: normalized.limit,
      offset: normalized.offset,
      hasMore: rows.length === normalized.limit,
    },
  };
}

export async function confirmPhotoCardImage(input: ConfirmPhotoCardImageInput) {
  await ensurePhotoCardSearchSupport();

  const product = await prisma.product.findUnique({
    where: { id: input.cardId },
    select: { id: true, imageUrl: true },
  });

  if (!product) {
    throw new Error("Product not found.");
  }

  if (!input.userFrontImageUrl.startsWith("data:image/")) {
    throw new Error("user_front_image_url must be an image data URL.");
  }

  const publicBaseUrl = input.publicBaseUrl?.replace(/\/+$/, "");
  const frontListingImageUrl = publicBaseUrl
    ? `${publicBaseUrl}/api/products/image-match/assets/${input.cardId}/front`
    : input.userFrontImageUrl;
  const backListingImageUrl =
    publicBaseUrl && input.userBackImageUrl
      ? `${publicBaseUrl}/api/products/image-match/assets/${input.cardId}/back`
      : input.userBackImageUrl;
  const imageUrls = [frontListingImageUrl, backListingImageUrl].filter(
    (value): value is string => Boolean(value),
  );
  const sourceImageUrl =
    product.imageUrl && product.imageUrl.includes("/api/products/image-match/assets/")
      ? null
      : product.imageUrl;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: input.cardId },
      data: {
        imageUrl: frontListingImageUrl,
        ebayImageUrls: imageUrls,
      },
    });

    await tx.$executeRaw`
      UPDATE "products"
      SET
        "source_image_url" = COALESCE("source_image_url", ${sourceImageUrl}),
        "user_front_image_url" = ${input.userFrontImageUrl},
        "user_back_image_url" = ${input.userBackImageUrl ?? null},
        "image_source" = 'user_uploaded',
        "has_back_image" = ${Boolean(input.userBackImageUrl)},
        "matched_by" = 'manual',
        "match_confidence" = NULL,
        "verified_at" = CURRENT_TIMESTAMP,
        "image_signature" = NULL,
        "image_phash" = NULL,
        "image_dhash" = NULL,
        "image_ahash" = NULL,
        "orb_descriptor_path" = NULL,
        "image_fingerprint_updated_at" = NULL
      WHERE "id" = ${input.cardId}
    `;
  });

  return prisma.product.findUniqueOrThrow({
    where: { id: input.cardId },
    select: {
      id: true,
      sku: true,
      productName: true,
      optionName: true,
      imageUrl: true,
      ebayImageUrls: true,
    },
  });
}

export function normalizePhotoCardCandidateFilters(
  filters: PhotoCardCandidateFilters,
) {
  return {
    group: normalizeText(filters.group),
    member: normalizeText(filters.member),
    album: normalizeText(filters.album),
    version: normalizeText(filters.version),
    keyword: normalizeText(filters.keyword),
    limit: clampLimit(filters.limit),
    offset: Math.max(0, Number(filters.offset) || 0),
  };
}

async function ensurePhotoCardSearchSupport() {
  await ensureProductImageMatchColumns();

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_photo_brand_lower_idx"
      ON "products" (LOWER("brand"))
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_photo_member_lower_idx"
      ON "products" (LOWER("option_name"))
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_photo_album_lower_idx"
      ON "products" (LOWER("category"))
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_photo_title_lower_idx"
      ON "products" (LOWER("product_name"))
  `;
}

async function loadPhotoCardFacets(
  filters: ReturnType<typeof normalizePhotoCardCandidateFilters>,
): Promise<PhotoCardFacetOptions> {
  const [groups, members, albums, versions] = await Promise.all([
    distinctFacet("brand", filters, new Set(["group"])),
    distinctFacet("option_name", filters, new Set(["member"])),
    distinctFacet("category", filters, new Set(["album"])),
    distinctFacet("product_name", filters, new Set(["version"])),
  ]);

  return { groups, members, albums, versions };
}

async function distinctFacet(
  column: "brand" | "option_name" | "category" | "product_name",
  filters: ReturnType<typeof normalizePhotoCardCandidateFilters>,
  omitted: Set<keyof ReturnType<typeof normalizePhotoCardCandidateFilters>>,
) {
  const clauses = candidateWhereClauses(filters, omitted);
  const whereSql = clauses.length
    ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`
    : Prisma.empty;
  const columnSql = facetColumnSql(column);
  const rows = await prisma.$queryRaw<DistinctValueRow[]>`
    SELECT DISTINCT ${columnSql} AS "value"
    FROM "products"
    ${whereSql}
      ${clauses.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} ${columnSql} IS NOT NULL
      AND ${columnSql} <> ''
    ORDER BY "value"
    LIMIT 200
  `;

  return rows
    .map((row) => row.value?.trim())
    .filter((value): value is string => Boolean(value));
}

function candidateWhereClauses(
  filters: ReturnType<typeof normalizePhotoCardCandidateFilters>,
  omitted = new Set<keyof ReturnType<typeof normalizePhotoCardCandidateFilters>>(),
) {
  const clauses = [Prisma.sql`("status" IS NULL OR "status" <> 'inactive')`];

  if (filters.group && !omitted.has("group")) {
    clauses.push(Prisma.sql`COALESCE("brand", '') ILIKE ${prefixPattern(filters.group)}`);
  }

  if (filters.member && !omitted.has("member")) {
    clauses.push(
      Prisma.sql`COALESCE("option_name", '') ILIKE ${prefixPattern(filters.member)}`,
    );
  }

  if (filters.album && !omitted.has("album")) {
    clauses.push(Prisma.sql`COALESCE("category", '') ILIKE ${prefixPattern(filters.album)}`);
  }

  if (filters.version && !omitted.has("version")) {
    const versionLike = likePattern(filters.version);
    clauses.push(
      Prisma.sql`(COALESCE("product_name", '') ILIKE ${versionLike} OR COALESCE("memo", '') ILIKE ${versionLike})`,
    );
  }

  if (filters.keyword && !omitted.has("keyword")) {
    const keywordLike = likePattern(filters.keyword);
    clauses.push(Prisma.sql`(
      COALESCE("sku", '') ILIKE ${keywordLike}
      OR COALESCE("internal_code", '') ILIKE ${keywordLike}
      OR COALESCE("product_name", '') ILIKE ${keywordLike}
      OR COALESCE("option_name", '') ILIKE ${keywordLike}
      OR COALESCE("category", '') ILIKE ${keywordLike}
      OR COALESCE("brand", '') ILIKE ${keywordLike}
      OR COALESCE("memo", '') ILIKE ${keywordLike}
    )`);
  }

  return clauses;
}

function candidateOrderClauses(
  filters: ReturnType<typeof normalizePhotoCardCandidateFilters>,
) {
  const clauses = [
    Prisma.sql`CASE WHEN "user_front_image_url" IS NOT NULL AND "user_front_image_url" <> '' THEN 1 ELSE 0 END`,
    Prisma.sql`CASE WHEN "stock_quantity" > 0 THEN 0 ELSE 1 END`,
  ];

  if (filters.member) {
    clauses.push(
      Prisma.sql`CASE WHEN LOWER(COALESCE("option_name", '')) = LOWER(${filters.member}) THEN 0 ELSE 1 END`,
    );
  }

  if (filters.album) {
    clauses.push(
      Prisma.sql`CASE WHEN LOWER(COALESCE("category", '')) = LOWER(${filters.album}) THEN 0 ELSE 1 END`,
    );
  }

  if (filters.group) {
    clauses.push(
      Prisma.sql`CASE WHEN LOWER(COALESCE("brand", '')) = LOWER(${filters.group}) THEN 0 ELSE 1 END`,
    );
  }

  if (filters.version) {
    clauses.push(
      Prisma.sql`CASE WHEN LOWER(COALESCE("product_name", '')) = LOWER(${filters.version}) THEN 0 ELSE 1 END`,
    );
  }

  return [
    ...clauses,
    Prisma.sql`LOWER(COALESCE("brand", ''))`,
    Prisma.sql`LOWER(COALESCE("category", ''))`,
    Prisma.sql`LOWER(COALESCE("option_name", ''))`,
    Prisma.sql`LOWER(COALESCE("product_name", ''))`,
    Prisma.sql`"sku"`,
  ];
}

function facetColumnSql(
  column: "brand" | "option_name" | "category" | "product_name",
) {
  switch (column) {
    case "brand":
      return Prisma.sql`"brand"`;
    case "option_name":
      return Prisma.sql`"option_name"`;
    case "category":
      return Prisma.sql`"category"`;
    case "product_name":
      return Prisma.sql`"product_name"`;
  }
}

function toPhotoCardCandidate(row: PhotoCardCandidateRow): PhotoCardCandidate {
  return {
    cardId: row.cardId,
    id: row.cardId,
    sku: row.sku,
    title: row.title,
    groupName: row.groupName,
    memberName: row.memberName,
    albumName: row.albumName,
    versionName: row.versionName,
    existingImageUrl: row.existingImageUrl,
    currentImageUrl: row.currentImageUrl,
    stockQuantity: row.stockQuantity,
    userImageRegistered: row.userImageRegistered,
    hasBackImage: row.hasBackImage,
  };
}

function normalizeText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

function clampLimit(value: number | null | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(maxLimit, Math.floor(parsed));
}

function likePattern(value: string) {
  return `%${value.replace(/[%_\\]/g, "\\$&")}%`;
}

function prefixPattern(value: string) {
  return `${value.replace(/[%_\\]/g, "\\$&")}%`;
}
