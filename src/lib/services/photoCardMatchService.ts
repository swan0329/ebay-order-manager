import sharp from "sharp";
import { Prisma } from "@/generated/prisma";
import { deleteObjectFromR2, r2KeyFromPublicUrl, uploadBufferToR2 } from "@/lib/r2";
import { prisma } from "@/lib/prisma";
import { ensureProductImageMatchColumns } from "@/lib/services/productImageMatchService";

const defaultLimit = 50;
const maxLimit = 50;
const facetCacheTtlMs = 60_000;
let photoCardSearchSupportPromise: Promise<void> | null = null;
const photoCardFacetCache = new Map<
  string,
  {
    expiresAt: number;
    value: PhotoCardFacetOptions;
  }
>();

export type PhotoCardCandidateFilters = {
  group?: string | null;
  member?: string | null;
  album?: string | null;
  version?: string | null;
  keyword?: string | null;
  includeRegistered?: boolean | null;
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
  sourceImageUrl: string | null;
  imageSource: string | null;
  userFrontImageUrl: string | null;
  userBackImageUrl: string | null;
  userFrontR2Key: string | null;
  userBackR2Key: string | null;
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
  sourceImageUrl: string | null;
  imageSource: string | null;
  userFrontImageUrl: string | null;
  userBackImageUrl: string | null;
  userFrontR2Key: string | null;
  userBackR2Key: string | null;
  stockQuantity: number;
  userImageRegistered: boolean;
  hasBackImage: boolean;
};

type ProductPhotoCardRow = {
  id: string;
  sku: string;
  internalCode: string | null;
  groupName: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  imageSource: string | null;
  userFrontImageUrl: string | null;
  userBackImageUrl: string | null;
  userFrontR2Key: string | null;
  userBackR2Key: string | null;
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

export type DeleteR2PhotoCardImageInput = {
  productId: string;
  side: "front" | "back" | "all";
};

export type PhotoCardImageUpdateResult = {
  id: string;
  sku: string;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  imageSource: string | null;
  userFrontImageUrl: string | null;
  userBackImageUrl: string | null;
  userFrontR2Key: string | null;
  userBackR2Key: string | null;
  hasBackImage: boolean;
  ebayImageUrls: string[];
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
      "source_image_url" AS "sourceImageUrl",
      "image_source" AS "imageSource",
      "user_front_image_url" AS "userFrontImageUrl",
      "user_back_image_url" AS "userBackImageUrl",
      "user_front_r2_key" AS "userFrontR2Key",
      "user_back_r2_key" AS "userBackR2Key",
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

export async function confirmPhotoCardImage(
  input: ConfirmPhotoCardImageInput,
): Promise<PhotoCardImageUpdateResult> {
  await ensurePhotoCardSearchSupport();

  const product = await loadProductForPhotoCard(input.cardId);

  if (!product) {
    throw new Error("Product not found.");
  }

  const frontBuffer = await optimizedJpegBufferFromDataUrl(input.userFrontImageUrl);
  const backBuffer = input.userBackImageUrl
    ? await optimizedJpegBufferFromDataUrl(input.userBackImageUrl)
    : null;
  const objectKeys = photoCardR2ObjectKeys({
    groupName: product.groupName,
    productCode: photoCardProductCode({
      internalCode: product.internalCode,
      sku: product.sku,
      id: product.id,
    }),
  });

  const uploadedKeys: string[] = [];
  let frontUpload: { key: string; url: string } | null = null;
  let backUpload: { key: string; url: string } | null = null;

  try {
    frontUpload = await uploadBufferToR2({
      buffer: frontBuffer,
      key: objectKeys.frontKey,
      contentType: "image/jpeg",
    });
    uploadedKeys.push(frontUpload.key);

    if (backBuffer) {
      backUpload = await uploadBufferToR2({
        buffer: backBuffer,
        key: objectKeys.backKey,
        contentType: "image/jpeg",
      });
      uploadedKeys.push(backUpload.key);
    }
  } catch (error) {
    await cleanupUploadedR2Objects(uploadedKeys);
    throw error;
  }

  if (!frontUpload) {
    throw new Error("Failed to upload front image to R2.");
  }

  const previousFrontKey =
    normalizeText(product.userFrontR2Key) ?? r2KeyFromPublicUrl(product.userFrontImageUrl);
  const previousBackKey =
    normalizeText(product.userBackR2Key) ?? r2KeyFromPublicUrl(product.userBackImageUrl);
  const sourceImageUrl = sourceImageUrlForPhotoCardUpdate(
    product.sourceImageUrl,
    product.imageUrl,
    product.imageSource,
  );
  const nextBackImageUrl = backUpload?.url ?? normalizeText(product.userBackImageUrl);
  const nextBackR2Key = backUpload?.key ?? previousBackKey;
  const imageUrls = photoCardListingImageUrls({
    userFrontImageUrl: frontUpload.url,
    userBackImageUrl: nextBackImageUrl,
    sourceImageUrl,
    imageUrl: frontUpload.url,
  }).imageUrls;

  await prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_url" = ${frontUpload.url},
      "ebay_image_urls" = ${textArraySql(imageUrls)},
      "source_image_url" = ${sourceImageUrl},
      "user_front_image_url" = ${frontUpload.url},
      "user_back_image_url" = ${nextBackImageUrl},
      "user_front_r2_key" = ${frontUpload.key},
      "user_back_r2_key" = ${nextBackR2Key},
      "image_source" = 'r2_user_uploaded',
      "has_back_image" = ${Boolean(nextBackImageUrl)},
      "matched_by" = 'manual',
      "match_confidence" = NULL,
      "verified_at" = CURRENT_TIMESTAMP,
      "image_signature" = NULL,
      "image_phash" = NULL,
      "image_dhash" = NULL,
      "image_ahash" = NULL,
      "orb_descriptor_path" = NULL,
      "image_fingerprint_updated_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.cardId}
  `;

  await cleanupStaleUploadedKeys({
    previousFrontKey,
    previousBackKey,
    currentFrontKey: frontUpload.key,
    currentBackKey: nextBackR2Key,
    backReplaced: Boolean(backUpload),
  });

  const updated = await loadProductForPhotoCard(input.cardId);

  if (!updated) {
    throw new Error("Product not found after update.");
  }

  return {
    id: updated.id,
    sku: updated.sku,
    imageUrl: frontUpload.url,
    sourceImageUrl,
    imageSource: "r2_user_uploaded",
    userFrontImageUrl: frontUpload.url,
    userBackImageUrl: nextBackImageUrl,
    userFrontR2Key: frontUpload.key,
    userBackR2Key: nextBackR2Key,
    hasBackImage: Boolean(nextBackImageUrl),
    ebayImageUrls: imageUrls,
  };
}

export async function deleteR2PhotoCardImage(
  input: DeleteR2PhotoCardImageInput,
): Promise<PhotoCardImageUpdateResult> {
  await ensurePhotoCardSearchSupport();

  const product = await loadProductForPhotoCard(input.productId);

  if (!product) {
    throw new Error("Product not found.");
  }

  const currentFrontKey =
    normalizeText(product.userFrontR2Key) ?? r2KeyFromPublicUrl(product.userFrontImageUrl);
  const currentBackKey =
    normalizeText(product.userBackR2Key) ?? r2KeyFromPublicUrl(product.userBackImageUrl);
  const deleteTargets =
    input.side === "front"
      ? [currentFrontKey]
      : input.side === "back"
        ? [currentBackKey]
        : [currentFrontKey, currentBackKey];
  const uniqueDeleteTargets = [...new Set(deleteTargets.filter(Boolean))];

  for (const key of uniqueDeleteTargets) {
    const result = await deleteObjectFromR2(key);

    if (!result.ok) {
      throw new Error(result.error ?? `Failed to delete R2 object: ${key}`);
    }
  }

  const sourceImageUrl = normalizeText(product.sourceImageUrl);
  let nextFrontImageUrl = normalizeText(product.userFrontImageUrl);
  let nextBackImageUrl = normalizeText(product.userBackImageUrl);
  let nextFrontR2Key = currentFrontKey;
  let nextBackR2Key = currentBackKey;

  if (input.side === "front" || input.side === "all") {
    nextFrontImageUrl = null;
    nextFrontR2Key = null;
  }

  if (input.side === "back" || input.side === "all") {
    nextBackImageUrl = null;
    nextBackR2Key = null;
  }

  const nextImageUrl =
    input.side === "front" || input.side === "all"
      ? sourceImageUrl
      : nextFrontImageUrl ?? sourceImageUrl;
  const nextImageSource = photoCardImageSource({
    userFrontImageUrl: nextFrontImageUrl,
    sourceImageUrl,
  });
  const nextHasBackImage = Boolean(nextBackImageUrl);
  const imageUrls =
    input.side === "front" && !nextFrontImageUrl && nextBackImageUrl
      ? [nextBackImageUrl]
      : photoCardListingImageUrls({
          userFrontImageUrl: nextFrontImageUrl,
          userBackImageUrl: nextBackImageUrl,
          sourceImageUrl,
          imageUrl: nextImageUrl,
        }).imageUrls;

  await prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_url" = ${nextImageUrl},
      "ebay_image_urls" = ${textArraySql(imageUrls)},
      "user_front_image_url" = ${nextFrontImageUrl},
      "user_back_image_url" = ${nextBackImageUrl},
      "user_front_r2_key" = ${nextFrontR2Key},
      "user_back_r2_key" = ${nextBackR2Key},
      "image_source" = ${nextImageSource},
      "has_back_image" = ${nextHasBackImage},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.productId}
  `;

  const updated = await loadProductForPhotoCard(input.productId);

  if (!updated) {
    throw new Error("Product not found after delete.");
  }

  return {
    id: updated.id,
    sku: updated.sku,
    imageUrl: nextImageUrl,
    sourceImageUrl,
    imageSource: nextImageSource,
    userFrontImageUrl: nextFrontImageUrl,
    userBackImageUrl: nextBackImageUrl,
    userFrontR2Key: nextFrontR2Key,
    userBackR2Key: nextBackR2Key,
    hasBackImage: nextHasBackImage,
    ebayImageUrls: imageUrls,
  };
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
    includeRegistered: filters.includeRegistered === true,
    limit: clampLimit(filters.limit),
    offset: Math.max(0, Number(filters.offset) || 0),
  };
}

export function photoCardListingImageUrls(input: {
  userFrontImageUrl?: string | null;
  userBackImageUrl?: string | null;
  sourceImageUrl?: string | null;
  imageUrl?: string | null;
}) {
  const frontListingImageUrl = normalizeText(input.userFrontImageUrl);
  const backListingImageUrl = normalizeText(input.userBackImageUrl);
  const sourceImageUrl = normalizeText(input.sourceImageUrl);
  const imageUrl = normalizeText(input.imageUrl);
  const imageUrls: string[] = [];

  if (frontListingImageUrl) {
    imageUrls.push(frontListingImageUrl);

    if (backListingImageUrl) {
      imageUrls.push(backListingImageUrl);
    }

    return { frontListingImageUrl, backListingImageUrl, imageUrls };
  }

  if (sourceImageUrl) {
    imageUrls.push(sourceImageUrl);
  } else if (imageUrl) {
    imageUrls.push(imageUrl);
  }

  return { frontListingImageUrl, backListingImageUrl, imageUrls };
}

export function photoCardImageSource(input: {
  userFrontImageUrl?: string | null;
  sourceImageUrl?: string | null;
}) {
  if (normalizeText(input.userFrontImageUrl)) {
    return "r2_user_uploaded";
  }

  if (normalizeText(input.sourceImageUrl)) {
    return "pocamarket";
  }

  return null;
}

export function sourceImageUrlForPhotoCardUpdate(
  currentSourceImageUrl: string | null,
  currentImageUrl?: string | null,
  currentImageSource?: string | null,
) {
  const source = normalizeText(currentSourceImageUrl);

  if (source) {
    return source;
  }

  const current = normalizeText(currentImageUrl);

  if (!current) {
    return null;
  }

  const imageSource = String(currentImageSource ?? "").toLowerCase();

  if (imageSource && imageSource !== "pocamarket") {
    return null;
  }

  if (current.includes("/api/products/image-match/assets/")) {
    return null;
  }

  if (r2KeyFromPublicUrl(current)) {
    return null;
  }

  if (/\.r2\.(?:dev|cloudflarestorage\.com)/i.test(current)) {
    return null;
  }

  return current;
}

export function photoCardGroupSlug(groupName: string | null | undefined) {
  const text = String(groupName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || "unknown";
}

export function photoCardProductCode(input: {
  productCode?: string | null;
  internalCode?: string | null;
  sku?: string | null;
  id: string;
}) {
  const primary = sanitizeProductCode(input.productCode);
  const secondary = sanitizeProductCode(input.internalCode);
  const tertiary = sanitizeProductCode(input.sku);
  const fallback = sanitizeProductCode(input.id);

  return primary ?? secondary ?? tertiary ?? fallback ?? input.id;
}

export function photoCardR2ObjectKeys(input: {
  groupName: string | null | undefined;
  productCode: string;
}) {
  const groupSlug = photoCardGroupSlug(input.groupName);
  const productCode = sanitizeProductCode(input.productCode) ?? "item";

  return {
    frontKey: `${groupSlug}/${productCode}_front.jpg`,
    backKey: `${groupSlug}/${productCode}_back.jpg`,
  };
}

async function ensurePhotoCardSearchSupport() {
  photoCardSearchSupportPromise ??= createPhotoCardSearchSupport().catch((error) => {
    photoCardSearchSupportPromise = null;
    throw error;
  });

  await photoCardSearchSupportPromise;
}

async function createPhotoCardSearchSupport() {
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

async function loadProductForPhotoCard(cardId: string) {
  const rows = await prisma.$queryRaw<ProductPhotoCardRow[]>`
    SELECT
      "id",
      "sku",
      "internal_code" AS "internalCode",
      "brand" AS "groupName",
      "image_url" AS "imageUrl",
      "source_image_url" AS "sourceImageUrl",
      "image_source" AS "imageSource",
      "user_front_image_url" AS "userFrontImageUrl",
      "user_back_image_url" AS "userBackImageUrl",
      "user_front_r2_key" AS "userFrontR2Key",
      "user_back_r2_key" AS "userBackR2Key"
    FROM "products"
    WHERE "id" = ${cardId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function optimizedJpegBufferFromDataUrl(dataUrl: string) {
  const sourceBuffer = imageBufferFromDataUrl(dataUrl);

  return sharp(sourceBuffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 90,
      mozjpeg: true,
    })
    .toBuffer();
}

function imageBufferFromDataUrl(dataUrl: string) {
  const text = String(dataUrl ?? "").trim();
  const match = text.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);

  if (!match) {
    throw new Error("user_front_image_url must be an image data URL.");
  }

  return Buffer.from(match[1], "base64");
}

async function cleanupUploadedR2Objects(keys: string[]) {
  if (!keys.length) {
    return;
  }

  await Promise.all(keys.map((key) => deleteObjectFromR2(key)));
}

async function cleanupStaleUploadedKeys(input: {
  previousFrontKey: string | null;
  previousBackKey: string | null;
  currentFrontKey: string | null;
  currentBackKey: string | null;
  backReplaced: boolean;
}) {
  const staleKeys: string[] = [];

  if (input.previousFrontKey && input.previousFrontKey !== input.currentFrontKey) {
    staleKeys.push(input.previousFrontKey);
  }

  if (
    input.backReplaced &&
    input.previousBackKey &&
    input.previousBackKey !== input.currentBackKey
  ) {
    staleKeys.push(input.previousBackKey);
  }

  if (!staleKeys.length) {
    return;
  }

  await Promise.all(staleKeys.map((key) => deleteObjectFromR2(key)));
}

function textArraySql(values: string[]) {
  if (!values.length) {
    return Prisma.sql`ARRAY[]::TEXT[]`;
  }

  return Prisma.sql`ARRAY[${Prisma.join(values)}]::TEXT[]`;
}

async function loadPhotoCardFacets(
  filters: ReturnType<typeof normalizePhotoCardCandidateFilters>,
): Promise<PhotoCardFacetOptions> {
  const now = Date.now();
  const cacheKey = photoCardFacetCacheKey(filters);
  const cached = photoCardFacetCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const filteredFacetFilters = {
    ...filters,
    offset: 0,
  };
  const [groups, members, albums, versions] = await Promise.all([
    distinctFacet("brand", filteredFacetFilters, new Set()),
    distinctFacet("option_name", filteredFacetFilters, new Set()),
    distinctFacet("category", filteredFacetFilters, new Set()),
    distinctFacet("product_name", filteredFacetFilters, new Set()),
  ]);

  const value = { groups, members, albums, versions };
  pruneExpiredFacetCache(now);
  photoCardFacetCache.set(cacheKey, { expiresAt: now + facetCacheTtlMs, value });

  return value;
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

  if (!filters.includeRegistered) {
    clauses.push(
      Prisma.sql`("user_front_image_url" IS NULL OR "user_front_image_url" = '')`,
    );
  }

  if (filters.group && !omitted.has("group")) {
    clauses.push(Prisma.sql`COALESCE("brand", '') ILIKE ${prefixPattern(filters.group)}`);
  }

  if (filters.member && !omitted.has("member")) {
    clauses.push(
      Prisma.sql`COALESCE("option_name", '') ILIKE ${prefixPattern(filters.member)}`,
    );
  }

  if (filters.album && !omitted.has("album")) {
    const albumLike = likePattern(filters.album);
    clauses.push(
      Prisma.sql`(
        COALESCE("category", '') ILIKE ${albumLike}
        OR COALESCE("product_name", '') ILIKE ${albumLike}
        OR COALESCE("memo", '') ILIKE ${albumLike}
      )`,
    );
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
    sourceImageUrl: row.sourceImageUrl,
    imageSource: row.imageSource,
    userFrontImageUrl: row.userFrontImageUrl,
    userBackImageUrl: row.userBackImageUrl,
    userFrontR2Key: row.userFrontR2Key,
    userBackR2Key: row.userBackR2Key,
    stockQuantity: row.stockQuantity,
    userImageRegistered: row.userImageRegistered,
    hasBackImage: row.hasBackImage,
  };
}

function normalizeText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

function sanitizeProductCode(value: string | null | undefined) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return text || null;
}

function photoCardFacetCacheKey(
  filters: ReturnType<typeof normalizePhotoCardCandidateFilters>,
) {
  return [
    filters.includeRegistered ? "1" : "0",
    filters.group ?? "",
    filters.member ?? "",
    filters.album ?? "",
    filters.version ?? "",
    filters.keyword ?? "",
  ].join("\u0001");
}

function pruneExpiredFacetCache(now: number) {
  for (const [key, value] of photoCardFacetCache.entries()) {
    if (value.expiresAt <= now) {
      photoCardFacetCache.delete(key);
    }
  }

  if (photoCardFacetCache.size > 200) {
    photoCardFacetCache.clear();
  }
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
