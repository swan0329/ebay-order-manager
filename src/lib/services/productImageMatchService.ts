import sharp from "sharp";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  clipEmbeddingDim,
  cosineSimilarity,
} from "./clipEmbeddingService";

export const maxProductMatchImageBytes = 2_500_000;

const normalizedSize = 512;
const hashCandidateLimit = 80;
const maxHashDistance = 64;
const defaultScanLimit = 12000;
const filteredScanLimit = 5000;
// Fetch the scan set in pages of this size instead of one giant query. With
// connection_limit=1, a single 12k-row × 512-float-embedding query holds the
// only DB connection for tens of seconds and starves concurrent requests
// (page polling, keepalive) into pool-timeout errors (P2024). Paging releases
// the connection between batches while returning the exact same rows/ranking.
const imageScanBatchSize = 2000;
const clipCandidatePoolLimit = 900;
const orbRescoreLimit = 240;
// When filters (group/member/album/version) narrow the scope, evaluate the whole
// small set instead of pre-cutting by CLIP rank, so geometric/color signals on
// already-fingerprinted cards can confirm the exact card even if CLIP ranks it low.
const filteredCandidatePoolLimit = 120;
// ORB geometry rescoring (and the heavy per-row image_signature JSONB fetch it
// needs) is the slow stage. Cap it to the top CLIP/hash-ranked candidates instead
// of the whole filtered member set (which could be hundreds of cards → tens of
// seconds). The true card, when geometry can confirm it at all, virtually always
// sits inside the top CLIP ranks; deeper candidates keep their CLIP ordering.
const filteredOrbRescoreLimit = 64;
// Full-catalog image search is allowed only for genuinely similar cards. Low
// scores are visually unrelated noise and are more harmful than an empty result.
const unfilteredMinimumScore = 0.52;
const descriptorPairs = buildDescriptorPairs();
let productImageMatchColumnsPromise: Promise<void> | null = null;

type ImageSource = "pocamarket" | "user_uploaded";
type MatchedBy = "image_similarity" | "manual" | "google_search";

type ProductImageRow = {
  id: string;
  sku: string;
  productName: string;
  optionName: string | null;
  category: string | null;
  brand: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  imagePhash: string | null;
  imageDhash: string | null;
  imageAhash: string | null;
  stockQuantity: number | null;
  salePrice: number | null;
  ebayPrice: number | null;
  featuredMembers: string | null;
  clipEmbeddingJson?: unknown;
};

function normalizeMatchMetadata(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, "");
}

export function matchesImageCandidateMetadata(
  candidate: { brand?: string | null; optionName?: string | null },
  filters: { group?: string | null; member?: string | null },
) {
  const group = normalizeMatchMetadata(filters.group);
  const member = normalizeMatchMetadata(filters.member);
  return (
    (!group || normalizeMatchMetadata(candidate.brand) === group) &&
    (!member || normalizeMatchMetadata(candidate.optionName) === member)
  );
}

export type OrbDescriptor = {
  x: number;
  y: number;
  bits: string;
};

export type VariantHashes = {
  phash: string;
  dhash: string;
  ahash: string;
};

export type ImageFingerprint = {
  fingerprintVersion: number;
  phash: string;
  dhash: string;
  ahash: string;
  width: number;
  height: number;
  descriptors: OrbDescriptor[];
  colorHistogram?: number[];
  variantHashes?: VariantHashes[];
  clipEmbedding?: number[];
};

const colorHistogramBins = 64;
// Bump when persisted fingerprint semantics change so the batch refreshes old rows once.
export const imageFingerprintVersion = 2;
const perceptualHashSize = 32;
const perceptualHashFrequencyCount = 8;
const dctCosineTable = Array.from(
  { length: perceptualHashFrequencyCount },
  (_, frequency) =>
    Array.from({ length: perceptualHashSize }, (_, point) =>
      Math.cos(((2 * point + 1) * frequency * Math.PI) / (2 * perceptualHashSize)),
    ),
);

export type PreparedProductImages = {
  frontImageUrl: string;
  backImageUrl: string | null;
  frontFingerprint: ImageFingerprint;
};

export type ProductImageCandidate = {
  id: string;
  sku: string;
  productName: string;
  optionName: string | null;
  category: string | null;
  brand: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  stockQuantity: number | null;
  salePrice: number | null;
  ebayPrice: number | null;
  featuredMembers: string | null;
  similarity: number;
  finalScore: number;
  hashScore: number;
  hashDistance: number;
  orbMatchScore: number;
  orbMatchCount: number;
  homographyScore: number;
  homographyInliers: number;
  groupName: string | null;
  memberName: string | null;
  albumName: string | null;
  versionName: string | null;
  existingImageUrl: string | null;
};

export type ConfirmProductImageMatchInput = {
  productId: string;
  frontImageUrl: string;
  backImageUrl?: string | null;
  matchConfidence?: number | null;
  matchedBy?: MatchedBy;
  publicBaseUrl?: string | null;
};

type NormalizedImage = {
  pixels: Uint8Array;
  width: number;
  height: number;
};

type MatchSummary = {
  orbMatchScore: number;
  orbMatchCount: number;
  homographyScore: number;
  homographyInliers: number;
};

export async function ensureProductImageMatchColumns() {
  productImageMatchColumnsPromise ??= createProductImageMatchColumns().catch((error) => {
    productImageMatchColumnsPromise = null;
    throw error;
  });

  await productImageMatchColumnsPromise;
}

async function createProductImageMatchColumns() {
  await prisma.$executeRaw`
    ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "source_image_url" TEXT,
      ADD COLUMN IF NOT EXISTS "user_front_image_url" TEXT,
      ADD COLUMN IF NOT EXISTS "user_back_image_url" TEXT,
      ADD COLUMN IF NOT EXISTS "user_front_r2_key" TEXT,
      ADD COLUMN IF NOT EXISTS "user_back_r2_key" TEXT,
      ADD COLUMN IF NOT EXISTS "image_source" TEXT DEFAULT 'pocamarket',
      ADD COLUMN IF NOT EXISTS "has_back_image" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "matched_by" TEXT,
      ADD COLUMN IF NOT EXISTS "match_confidence" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "image_signature" JSONB,
      ADD COLUMN IF NOT EXISTS "image_phash" TEXT,
      ADD COLUMN IF NOT EXISTS "image_dhash" TEXT,
      ADD COLUMN IF NOT EXISTS "image_ahash" TEXT,
      ADD COLUMN IF NOT EXISTS "orb_descriptor_path" TEXT,
      ADD COLUMN IF NOT EXISTS "image_width" INTEGER,
      ADD COLUMN IF NOT EXISTS "image_height" INTEGER,
      ADD COLUMN IF NOT EXISTS "image_fingerprint_updated_at" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "featured_members" TEXT
  `;

  await prisma.$executeRaw`
    ALTER TABLE "products"
    ALTER COLUMN "image_source" DROP NOT NULL
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_image_source_idx"
      ON "products" ("image_source")
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_verified_at_idx"
      ON "products" ("verified_at")
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_image_fingerprint_updated_at_idx"
      ON "products" ("image_fingerprint_updated_at")
  `;
}

export async function prepareUploadedProductImages(
  frontImage: File,
  backImage?: File | null,
): Promise<PreparedProductImages> {
  const front = await fileToImageDataUrl(frontImage, "frontImage");
  const back =
    backImage && backImage.size > 0
      ? await fileToImageDataUrl(backImage, "backImage")
      : null;

  return {
    frontImageUrl: front.dataUrl,
    backImageUrl: back?.dataUrl ?? null,
    frontFingerprint: await computeImageFingerprintFromBuffer(front.buffer),
  };
}

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, "\\$&");
}

function rowToCandidate(
  row: ProductImageRow,
  scores: {
    hashDistance: number;
    hashScore: number;
    orbMatchScore: number;
    orbMatchCount: number;
    homographyScore: number;
    homographyInliers: number;
    finalScore: number;
  },
): ProductImageCandidate {
  return {
    id: row.id,
    sku: row.sku,
    productName: row.productName,
    optionName: row.optionName,
    category: row.category,
    brand: row.brand,
    imageUrl: row.imageUrl,
    sourceImageUrl: row.sourceImageUrl,
    stockQuantity: row.stockQuantity,
    salePrice: row.salePrice,
    ebayPrice: row.ebayPrice,
    featuredMembers: row.featuredMembers,
    similarity: scores.finalScore,
    finalScore: scores.finalScore,
    hashScore: scores.hashScore,
    hashDistance: scores.hashDistance,
    orbMatchScore: scores.orbMatchScore,
    orbMatchCount: scores.orbMatchCount,
    homographyScore: scores.homographyScore,
    homographyInliers: scores.homographyInliers,
    groupName: row.brand,
    memberName: row.optionName,
    albumName: row.category,
    versionName: row.productName,
    existingImageUrl: row.imageUrl,
  };
}

export async function findProductImageCandidates(
  uploadedFingerprint: ImageFingerprint,
  options: {
    limit?: number;
    scanLimit?: number;
    group?: string | null;
    member?: string | null;
    album?: string | null;
    version?: string | null;
  } = {},
): Promise<ProductImageCandidate[]> {
  await ensureProductImageMatchColumns();

  const limit = options.limit ?? 10;

  const extraClauses: Prisma.Sql[] = [];

  if (options.group) {
    extraClauses.push(
      Prisma.sql`REGEXP_REPLACE(LOWER(BTRIM(COALESCE("brand", ''))), '[[:space:]_.-]+', '', 'g') = ${normalizeMatchMetadata(options.group)}`,
    );
  }

  if (options.member) {
    extraClauses.push(
      Prisma.sql`REGEXP_REPLACE(LOWER(BTRIM(COALESCE("option_name", ''))), '[[:space:]_.-]+', '', 'g') = ${normalizeMatchMetadata(options.member)}`,
    );
  }

  if (options.album) {
    extraClauses.push(
      Prisma.sql`COALESCE("category", '') ILIKE ${"%" + escapeLike(options.album) + "%"}`,
    );
  }

  if (options.version) {
    // Match the candidate-list filter: version ("특전처"/POB) can live in either
    // the product name or the memo, and ILIKE keeps it case-insensitive.
    const versionLike = "%" + escapeLike(options.version) + "%";
    extraClauses.push(
      Prisma.sql`(COALESCE("product_name", '') ILIKE ${versionLike} OR COALESCE("memo", '') ILIKE ${versionLike})`,
    );
  }

  const hasFilters = extraClauses.length > 0;
  const scanLimit =
    options.scanLimit ?? (hasFilters ? filteredScanLimit : defaultScanLimit);
  const extraWhere = hasFilters
    ? Prisma.sql`AND ${Prisma.join(extraClauses, " AND ")}`
    : Prisma.empty;
  const uploadedHasClip = Boolean(uploadedFingerprint.clipEmbedding?.length);
  // When filters (member/album/…) narrow the set, return EVERY filter-matching
  // card that has an image — even ones without a CLIP embedding yet — so the UI's
  // "더보기" can expose them all. Only the unfiltered full-catalog search keeps the
  // embedding requirement (for speed); a filtered set is small enough to scan fully.
  const candidateClipWhere =
    uploadedHasClip && !hasFilters
      ? Prisma.sql`
      AND (
        CASE
          WHEN jsonb_typeof("image_signature" -> 'clipEmbedding') = 'array'
          THEN jsonb_array_length("image_signature" -> 'clipEmbedding')
          ELSE 0
        END
      ) = ${clipEmbeddingDim}
    `
      : Prisma.empty;
  const clipEmbeddingSelect = uploadedHasClip
    ? Prisma.sql`"image_signature" -> 'clipEmbedding'`
    : Prisma.sql`NULL`;

  // Page through the scan set so the single (connection_limit=1) DB connection
  // is released between batches instead of being held for the whole multi-MB
  // scan — see imageScanBatchSize. Same rows, same ORDER BY → identical ranking.
  const rows: ProductImageRow[] = [];
  for (let fetched = 0; fetched < scanLimit; fetched += imageScanBatchSize) {
    const batchLimit = Math.min(imageScanBatchSize, scanLimit - fetched);
    const batch = await prisma.$queryRaw<ProductImageRow[]>`
      SELECT
        "id",
        "sku",
        "product_name" AS "productName",
        "option_name" AS "optionName",
        "category",
        "brand",
        COALESCE("user_front_image_url", "image_url") AS "imageUrl",
        "source_image_url" AS "sourceImageUrl",
        "image_phash" AS "imagePhash",
        "image_dhash" AS "imageDhash",
        "image_ahash" AS "imageAhash",
        "stock_quantity" AS "stockQuantity",
        "sale_price"::float8 AS "salePrice",
        "ebay_price"::float8 AS "ebayPrice",
        "featured_members" AS "featuredMembers",
        ${clipEmbeddingSelect} AS "clipEmbeddingJson"
      FROM "products"
      WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
        AND COALESCE("user_front_image_url", "image_url") <> ''
      ${extraWhere}
      ${candidateClipWhere}
      ORDER BY "image_fingerprint_updated_at" DESC NULLS LAST, "updated_at" DESC
      LIMIT ${batchLimit} OFFSET ${fetched}
    `;
    rows.push(...batch);
    if (batch.length < batchLimit) {
      break;
    }
  }

  // SQL prefix matching keeps the query fast, then this strict normalized check
  // prevents a similarly-prefixed or completely different group/member from
  // ever entering the image ranking.
  const compatibleRows = rows.filter((row) =>
    matchesImageCandidateMetadata(row, options),
  );

  const inlineSignatures = new Map<string, ImageFingerprint>();
  const rowClipEmbeddings = new Map<string, number[]>();

  for (const row of compatibleRows) {
    const parsed = parseClipEmbeddingJson(row.clipEmbeddingJson);
    if (parsed) {
      rowClipEmbeddings.set(row.id, parsed);
    }
  }

  type ScoredRow = {
    row: ProductImageRow;
    hashDistance: number;
    hashScore: number;
    clipScore: number | null;
    rankingScore: number;
  };

  const scored: ScoredRow[] = [];
  const noFingerprint: ProductImageRow[] = [];

  const buildRanking = (
    row: ProductImageRow,
    hashDistance: number,
    hashScore: number,
  ): ScoredRow => {
    const candidateClip = rowClipEmbeddings.get(row.id);
    let clipScore: number | null = null;
    if (uploadedHasClip && candidateClip) {
      clipScore = (cosineSimilarity(uploadedFingerprint.clipEmbedding!, candidateClip) + 1) / 2;
    }
    const rankingScore =
      clipScore !== null
        ? Math.max(clipScore, hashScore * 0.98, clipScore * 0.72 + hashScore * 0.28)
        : hashScore;
    return { row, hashDistance, hashScore, clipScore, rankingScore };
  };

  for (const row of compatibleRows) {
    const hasHashes = Boolean(row.imagePhash && row.imageDhash && row.imageAhash);
    const hasClip = uploadedHasClip && rowClipEmbeddings.has(row.id);

    // A row is rankable if it can be compared by perceptual hashes OR by CLIP
    // embedding. Previously rows with a CLIP embedding but no hash columns (the
    // common case for cards embedded via the browser batch, which only writes
    // clipEmbedding) were dropped here — so CLIP never influenced the results.
    // Keep them whenever a CLIP comparison is possible.
    if (!hasHashes && !hasClip) {
      noFingerprint.push(row);
      continue;
    }

    const hashDistance = hasHashes
      ? combinedHashDistanceFromStrings(
          uploadedFingerprint,
          row.imagePhash!,
          row.imageDhash!,
          row.imageAhash!,
        )
      : maxHashDistance;
    const hashScore = hasHashes ? hashScoreFromDistance(hashDistance) : 0;
    scored.push(buildRanking(row, hashDistance, hashScore));
  }

  // NOTE: We deliberately do NOT fetch/compute fingerprints from image URLs
  // during search — fetching dozens of images synchronously blows the 60s
  // serverless timeout. Search ranks using only what's already stored in the DB
  // (CLIP embeddings, hashes, descriptors, color). Missing descriptors/color are
  // backfilled offline by the fingerprint batch, not here.

  // The pool of fully-scored candidates must be at least as large as the number
  // we intend to return (so "더보기" can page deep enough to reach a low-ranked
  // true match).
  const candidatePoolLimit = Math.max(
    hasFilters
      ? filteredCandidatePoolLimit
      : uploadedHasClip
        ? clipCandidatePoolLimit
        : hashCandidateLimit,
    limit,
  );
  const orbLimit = hasFilters
    ? Math.min(candidatePoolLimit, filteredOrbRescoreLimit)
    : orbRescoreLimit;

  const sortedHashCandidates = scored
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .slice(0, candidatePoolLimit);
  // Keep fingerprint-less rows as fillers when filtered, so they still surface at
  // the end of the list (via "더보기") instead of disappearing entirely.
  const unmatched = uploadedHasClip && !hasFilters ? [] : noFingerprint;

  // Only the top `orbLimit` candidates get ORB/color rescoring, so only they need
  // their full signature JSONB. Fetching it for the entire pool (up to hundreds of
  // rows) was the main latency cost; deeper candidates keep their CLIP ranking.
  const idsNeedingFetch = sortedHashCandidates
    .slice(0, orbLimit)
    .map((item) => item.row.id)
    .filter((id) => !inlineSignatures.has(id));
  const fetchedSignatureMap = await fetchSignaturesForIds(idsNeedingFetch);
  const signatureMap = new Map<string, ImageFingerprint | null>(fetchedSignatureMap);
  for (const [id, fingerprint] of inlineSignatures) {
    signatureMap.set(id, fingerprint);
  }

  const scoredCandidates = sortedHashCandidates.map((item, index) => {
    const signature = signatureMap.get(item.row.id) ?? null;
    const useOrb =
      index < orbLimit &&
      signature !== null &&
      signature.descriptors.length > 0 &&
      uploadedFingerprint.descriptors.length > 0;
    const featureMatch = useOrb
      ? compareOrbDescriptors(
          uploadedFingerprint.descriptors,
          signature!.descriptors,
        )
      : {
          orbMatchScore: 0,
          orbMatchCount: 0,
          homographyScore: 0,
          homographyInliers: 0,
        };
    const histogramScore =
      signature?.colorHistogram?.length && uploadedFingerprint.colorHistogram?.length
        ? histogramSimilarity(
            uploadedFingerprint.colorHistogram,
            signature.colorHistogram,
          )
        : null;
    const finalScore = combineFinalScore({
      hashScore: item.hashScore,
      orbMatchScore: featureMatch.orbMatchScore,
      homographyScore: featureMatch.homographyScore,
      histogramScore,
      hasFeatures: useOrb,
      clipScore: item.clipScore,
    });

    return rowToCandidate(item.row, {
      hashDistance: item.hashDistance,
      hashScore: item.hashScore,
      orbMatchScore: featureMatch.orbMatchScore,
      orbMatchCount: featureMatch.orbMatchCount,
      homographyScore: featureMatch.homographyScore,
      homographyInliers: featureMatch.homographyInliers,
      finalScore,
    });
  });

  scoredCandidates.sort((left, right) => right.finalScore - left.finalScore);
  // Do not prune CLIP-backed results too aggressively. Some true matches rank
  // lower when the card is glossy, rotated, cropped, or visually similar to
  // another version. Keep the full ranked pool so the UI's "더 보기" can expose
  // later candidates while still blocking no-CLIP hash-only garbage at the API.
  const returnableCandidates = hasFilters
    ? scoredCandidates
    : scoredCandidates.filter(
        (candidate) => candidate.finalScore >= unfilteredMinimumScore,
      );

  if (returnableCandidates.length >= limit) {
    void scheduleBackgroundFingerprinting(unmatched);
    return returnableCandidates.slice(0, limit);
  }

  const seen = new Set(returnableCandidates.map((candidate) => candidate.id));
  const fillerCandidates = unmatched
    .filter((row) => !seen.has(row.id))
    .slice(0, Math.max(0, limit - returnableCandidates.length))
    .map((row) =>
      rowToCandidate(row, {
        hashDistance: 64,
        hashScore: 0,
        orbMatchScore: 0,
        orbMatchCount: 0,
        homographyScore: 0,
        homographyInliers: 0,
        finalScore: 0,
      }),
    );

  void scheduleBackgroundFingerprinting(unmatched);

  return [...returnableCandidates, ...fillerCandidates].slice(0, limit);
}

export type ImageMatchDiagnosis =
  | { found: false; sku: string }
  | {
      found: true;
      sku: string;
      productName: string | null;
      group: string | null;
      member: string | null;
      album: string | null;
      hasImage: boolean;
      hasClipEmbedding: boolean;
      clipLen: number;
      hasHashes: boolean;
      uploadHasClip: boolean;
      clipScorePercent: number | null;
      passesFilters: boolean;
      filteredTotal: number | null;
      filteredRank: number | null;
      inResults: boolean;
    };

type ImageMatchFilters = {
  group?: string | null;
  member?: string | null;
  album?: string | null;
  version?: string | null;
};

// Tells the exact truth about why a specific card does/doesn't surface for an
// uploaded image: does it have an embedding, how similar is it to the upload,
// and where does it rank across the whole catalog. Replaces guesswork.
export async function diagnoseImageMatchForSku(
  uploadedFingerprint: ImageFingerprint,
  sku: string,
  filters: ImageMatchFilters = {},
  returnedIds: string[] = [],
): Promise<ImageMatchDiagnosis> {
  await ensureProductImageMatchColumns();

  const targetRows = await prisma.$queryRaw<
    Array<{
      id: string;
      sku: string;
      productName: string | null;
      group: string | null;
      member: string | null;
      album: string | null;
      imageUrl: string | null;
      hasHashes: boolean;
      clipLen: number | null;
      clipJson: unknown;
    }>
  >`
    SELECT
      "id",
      "sku",
      "product_name" AS "productName",
      "brand" AS "group",
      "option_name" AS "member",
      "category" AS "album",
      COALESCE("user_front_image_url", "image_url") AS "imageUrl",
      ("image_phash" IS NOT NULL AND "image_dhash" IS NOT NULL AND "image_ahash" IS NOT NULL) AS "hasHashes",
      CASE
        WHEN jsonb_typeof("image_signature" -> 'clipEmbedding') = 'array'
        THEN jsonb_array_length("image_signature" -> 'clipEmbedding')
        ELSE 0
      END AS "clipLen",
      ("image_signature" -> 'clipEmbedding') AS "clipJson"
    FROM "products"
    WHERE "sku" ILIKE ${sku.trim()}
    LIMIT 1
  `;

  const target = targetRows[0];
  if (!target) {
    return { found: false, sku };
  }

  const uploadClip = uploadedFingerprint.clipEmbedding;
  const uploadHasClip = Boolean(uploadClip?.length);
  const targetClip = parseClipEmbeddingJson(target.clipJson);

  let clipScorePercent: number | null = null;
  if (uploadHasClip && targetClip) {
    const targetCos = cosineSimilarity(uploadClip!, targetClip);
    clipScorePercent = Math.round(((targetCos + 1) / 2) * 100);
  }

  // Does this card satisfy the active filters? (same clauses the search uses)
  const filterClauses: Prisma.Sql[] = [];
  if (filters.group) {
    filterClauses.push(
      Prisma.sql`COALESCE("brand", '') ILIKE ${escapeLike(filters.group) + "%"}`,
    );
  }
  if (filters.member) {
    filterClauses.push(
      Prisma.sql`COALESCE("option_name", '') ILIKE ${escapeLike(filters.member) + "%"}`,
    );
  }
  if (filters.album) {
    filterClauses.push(
      Prisma.sql`COALESCE("category", '') ILIKE ${"%" + escapeLike(filters.album) + "%"}`,
    );
  }
  if (filters.version) {
    filterClauses.push(
      Prisma.sql`COALESCE("product_name", '') ILIKE ${"%" + escapeLike(filters.version) + "%"}`,
    );
  }

  let passesFilters = true;
  if (filterClauses.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM "products"
      WHERE "id" = ${target.id} AND ${Prisma.join(filterClauses, " AND ")}
      LIMIT 1
    `;
    passesFilters = rows.length > 0;
  }

  // Exact CLIP rank within the filtered set — cheap because filters bound the
  // set (e.g. one member). Only computed when filters are present; counting
  // across the whole catalog would be too heavy to do per request.
  let filteredTotal: number | null = null;
  let filteredRank: number | null = null;
  if (uploadHasClip && targetClip && passesFilters && filterClauses.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ clipJson: unknown }>>`
      SELECT ("image_signature" -> 'clipEmbedding') AS "clipJson"
      FROM "products"
      WHERE ${Prisma.join(filterClauses, " AND ")}
        AND COALESCE("user_front_image_url", "image_url") IS NOT NULL
        AND COALESCE("user_front_image_url", "image_url") <> ''
        AND (
          CASE
            WHEN jsonb_typeof("image_signature" -> 'clipEmbedding') = 'array'
            THEN jsonb_array_length("image_signature" -> 'clipEmbedding')
            ELSE 0
          END
        ) = ${clipEmbeddingDim}
    `;
    const targetCos = cosineSimilarity(uploadClip!, targetClip);
    let higher = 0;
    let total = 0;
    for (const row of rows) {
      const emb = parseClipEmbeddingJson(row.clipJson);
      if (!emb) continue;
      total += 1;
      if (cosineSimilarity(uploadClip!, emb) > targetCos) higher += 1;
    }
    filteredTotal = total;
    filteredRank = higher + 1;
  }

  return {
    found: true,
    sku: target.sku,
    productName: target.productName,
    group: target.group,
    member: target.member,
    album: target.album,
    hasImage: Boolean(target.imageUrl),
    hasClipEmbedding: Boolean(targetClip),
    clipLen: Number(target.clipLen ?? 0),
    hasHashes: target.hasHashes,
    uploadHasClip,
    clipScorePercent,
    passesFilters,
    filteredTotal,
    filteredRank,
    inResults: returnedIds.includes(target.id),
  };
}

async function fetchSignaturesForIds(
  ids: string[],
): Promise<Map<string, ImageFingerprint | null>> {
  const result = new Map<string, ImageFingerprint | null>();

  if (!ids.length) {
    return result;
  }

  const rows = await prisma.$queryRaw<
    Array<{ id: string; imageFingerprint: unknown }>
  >`
    SELECT "id", "image_signature" AS "imageFingerprint"
    FROM "products"
    WHERE "id" IN (${Prisma.join(ids)})
  `;

  for (const row of rows) {
    result.set(row.id, parseFingerprintJson(row.imageFingerprint));
  }

  return result;
}

function combinedHashDistanceFromStrings(
  uploaded: ImageFingerprint,
  phash: string,
  dhash: string,
  ahash: string,
): number {
  let best = weightedHashDistance(uploaded, phash, dhash, ahash);

  if (uploaded.variantHashes) {
    for (const variant of uploaded.variantHashes) {
      const distance = weightedHashDistance(variant, phash, dhash, ahash);
      if (distance < best) best = distance;
    }
  }

  return best;
}

function weightedHashDistance(
  source: VariantHashes,
  phash: string,
  dhash: string,
  ahash: string,
): number {
  return (
    hammingDistance(source.phash, phash) * 0.45 +
    hammingDistance(source.dhash, dhash) * 0.35 +
    hammingDistance(source.ahash, ahash) * 0.2
  );
}

function parseClipEmbeddingJson(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  const filtered: number[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isFinite(item)) {
      filtered.push(item);
    }
  }

  if (filtered.length !== clipEmbeddingDim) return null;
  return filtered;
}

function histogramSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.min(a[i] ?? 0, b[i] ?? 0);
  }
  return Math.max(0, Math.min(1, sum));
}

function combineFinalScore(params: {
  hashScore: number;
  orbMatchScore: number;
  homographyScore: number;
  histogramScore: number | null;
  hasFeatures: boolean;
  clipScore: number | null;
}): number {
  const {
    hashScore,
    orbMatchScore,
    homographyScore,
    histogramScore,
    hasFeatures,
    clipScore,
  } = params;

  if (clipScore !== null) {
    const colorComponent = histogramScore ?? 0.45;
    const orbComponent = hasFeatures ? orbMatchScore : 0;
    const homoComponent = hasFeatures ? homographyScore : 0;

    // Geometry/hash confirm a physical card when present, but for real-world
    // phone photos (perspective, glare, hand, background) vs clean catalog scans
    // they're usually weak or absent — so CLIP carries most of the signal and is
    // weighted highest. Geometry/hash then BOOST a candidate CLIP already likes
    // and break ties, rather than dominating and burying the true card under a
    // lookalike that happened to land a few ORB matches.
    const precision = Math.max(
      homoComponent,
      orbComponent * 0.9,
      hashScore >= 0.88 ? hashScore : 0,
      histogramScore !== null && histogramScore >= 0.82 && hashScore >= 0.72
        ? (histogramScore + hashScore) / 2
        : 0,
    );

    let score =
      clipScore * 0.52 +
      precision * 0.26 +
      hashScore * 0.12 +
      colorComponent * 0.10;

    // If the candidate has descriptors but they do not agree with the upload,
    // it is probably a CLIP lookalike rather than the same card. Soft penalty
    // only — ORB on glossy/holo cards photographed at an angle is noisy, so a
    // disagreement shouldn't fully bury an otherwise strong CLIP match.
    if (hasFeatures && orbComponent < 0.08 && homoComponent < 0.2 && hashScore < 0.72) {
      score *= 0.8;
    }

    // Color gate: cards with clearly different dominant card colors are almost
    // never the answer. Strong geometry can veto this for lighting/camera shifts.
    if (histogramScore !== null && histogramScore < 0.5 && hashScore < 0.86 && homoComponent < 0.5) {
      score *= 0.45 + histogramScore * 0.7;
    }

    // Very different hashes with no geometric support should not outrank a
    // mediocre but structurally matching candidate just because CLIP likes it.
    if (hashScore < 0.45 && homoComponent < 0.25 && orbComponent < 0.12) {
      score *= 0.75;
    }

    return Math.max(0, Math.min(1, score));
  }

  if (histogramScore !== null && hasFeatures) {
    return (
      hashScore * 0.3 +
      orbMatchScore * 0.35 +
      homographyScore * 0.15 +
      histogramScore * 0.2
    );
  }

  if (histogramScore !== null) {
    return hashScore * 0.6 + histogramScore * 0.4;
  }

  if (hasFeatures) {
    return (
      hashScore * 0.35 + orbMatchScore * 0.45 + homographyScore * 0.2
    );
  }

  return hashScore;
}

async function computeColorHistogramFromBuffer(
  buffer: Buffer | Uint8Array,
): Promise<number[]> {
  const base = await sharp(Buffer.from(buffer), { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const basePixels = base.data;
  const baseChannels = Math.max(1, base.info.channels);
  const baseWidth = base.info.width;
  const baseHeight = base.info.height;
  const greyscale = Buffer.alloc(baseWidth * baseHeight);

  for (
    let sourceIndex = 0, targetIndex = 0;
    sourceIndex < basePixels.length && targetIndex < greyscale.length;
    sourceIndex += baseChannels, targetIndex += 1
  ) {
    const r = basePixels[sourceIndex] ?? 0;
    const g = basePixels[sourceIndex + 1] ?? r;
    const b = basePixels[sourceIndex + 2] ?? r;
    greyscale[targetIndex] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }

  const crop = detectCardBounds(greyscale, baseWidth, baseHeight);
  let histogramSource = sharp(basePixels, {
    raw: {
      width: baseWidth,
      height: baseHeight,
      channels: baseChannels as 1 | 2 | 3 | 4,
    },
  });

  if (crop) {
    histogramSource = histogramSource.extract(crop);
  }

  const result = await histogramSource
    .resize({ width: 64, height: 64, fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = result.data;
  const channels = Math.max(1, result.info.channels);
  const bins = new Array<number>(colorHistogramBins).fill(0);

  for (let i = 0; i + 2 < pixels.length; i += channels) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? r;
    const b = pixels[i + 2] ?? r;
    const ri = Math.min(3, r >> 6);
    const gi = Math.min(3, g >> 6);
    const bi = Math.min(3, b >> 6);
    bins[ri * 16 + gi * 4 + bi] += 1;
  }

  const total = Math.floor(pixels.length / channels);

  if (!total) {
    return bins;
  }

  return bins.map((count) => count / total);
}

const backgroundFingerprintLimit = 6;

function scheduleBackgroundFingerprinting(rows: ProductImageRow[]) {
  if (!rows.length) {
    return;
  }

  const targets = rows.slice(0, backgroundFingerprintLimit);

  void (async () => {
    for (const row of targets) {
      if (!row.imageUrl) {
        continue;
      }

      try {
        const fingerprint = await imageFingerprintFromUrl(row.imageUrl);

        if (fingerprint) {
          await saveProductImageFingerprint(row.id, fingerprint);
        }
      } catch {
        // ignore — best-effort precomputation
      }
    }
  })();
}

export async function confirmProductImageMatch(input: ConfirmProductImageMatchInput) {
  await ensureProductImageMatchColumns();

  const existingRows = await prisma.$queryRaw<
    Array<{ id: string; imageUrl: string | null; userFrontImageUrl: string | null }>
  >`
    SELECT "id", "image_url" AS "imageUrl", "user_front_image_url" AS "userFrontImageUrl"
    FROM "products"
    WHERE "id" = ${input.productId}
    LIMIT 1
  `;
  const product = existingRows[0];

  if (!product) {
    throw new Error("Product not found.");
  }

  // First-time match bumps stock by 1 (one physical card matched). Re-saving an
  // image onto an already-matched product must not double-count.
  const isNewMatch = !product.userFrontImageUrl;

  const frontFingerprint = await imageFingerprintFromDataUrl(input.frontImageUrl);
  const publicBaseUrl = input.publicBaseUrl?.replace(/\/+$/, "");
  const frontListingImageUrl = publicBaseUrl
    ? `${publicBaseUrl}/api/products/image-match/assets/${input.productId}/front`
    : input.frontImageUrl;
  const backListingImageUrl =
    publicBaseUrl && input.backImageUrl
      ? `${publicBaseUrl}/api/products/image-match/assets/${input.productId}/back`
      : input.backImageUrl;
  const imageUrls = [frontListingImageUrl, backListingImageUrl].filter(
    (value): value is string => Boolean(value),
  );
  const sourceImageUrl =
    product.imageUrl && product.imageUrl.includes("/api/products/image-match/assets/")
      ? null
      : product.imageUrl;

  await prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_url" = ${frontListingImageUrl},
      "ebay_image_urls" = ${textArraySql(imageUrls)},
      "source_image_url" = COALESCE("source_image_url", ${sourceImageUrl}),
      "user_front_image_url" = ${input.frontImageUrl},
      "user_back_image_url" = ${input.backImageUrl ?? null},
      "image_source" = ${"user_uploaded" satisfies ImageSource},
      "has_back_image" = ${Boolean(input.backImageUrl)},
      "matched_by" = ${input.matchedBy ?? "image_similarity"},
      "match_confidence" = ${clampConfidence(input.matchConfidence)},
      "stock_quantity" = "stock_quantity" + ${isNewMatch ? 1 : 0},
      "status" = CASE
        WHEN ${isNewMatch} = FALSE THEN "status"
        WHEN "status" = 'active' THEN 'active'
        ELSE 'unlisted'
      END,
      "verified_at" = CURRENT_TIMESTAMP,
      "image_signature" = ${JSON.stringify(frontFingerprint)}::jsonb,
      "image_phash" = ${frontFingerprint.phash},
      "image_dhash" = ${frontFingerprint.dhash},
      "image_ahash" = ${frontFingerprint.ahash},
      "orb_descriptor_path" = ${"db:image_signature.descriptors"},
      "image_width" = ${frontFingerprint.width},
      "image_height" = ${frontFingerprint.height},
      "image_fingerprint_updated_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.productId}
  `;

  return prisma.product.findUniqueOrThrow({
    where: { id: input.productId },
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

export async function rebuildProductImageFingerprints(
  limit = 1000,
  options: {
    onlyMissing?: boolean;
    concurrency?: number;
    timeBudgetMs?: number;
  } = {},
) {
  await ensureProductImageMatchColumns();

  const onlyMissing = options.onlyMissing ?? true;
  const retryableClause = onlyMissing
    ? Prisma.sql`AND COALESCE("image_signature" ->> 'fingerprintBuildFailed', 'false') <> 'true'`
    : Prisma.empty;
  const missingClause = onlyMissing
    ? Prisma.sql`AND (
        "image_signature" IS NULL
        OR "image_phash" IS NULL
        OR "image_dhash" IS NULL
        OR "image_ahash" IS NULL
        OR ("image_signature" ->> 'phash') IS NULL
        OR ("image_signature" ->> 'dhash') IS NULL
        OR ("image_signature" ->> 'ahash') IS NULL
        OR COALESCE(jsonb_typeof("image_signature" -> 'descriptors'), '') <> 'array'
        OR ("image_signature" -> 'colorHistogram') IS NULL
        OR COALESCE(jsonb_typeof("image_signature" -> 'colorHistogram'), '') <> 'array'
        OR (
          CASE
            WHEN jsonb_typeof("image_signature" -> 'colorHistogram') = 'array'
            THEN jsonb_array_length("image_signature" -> 'colorHistogram')
            ELSE 0
          END
        ) <> ${colorHistogramBins}
        OR ("image_signature" ->> 'fingerprintVersion') IS DISTINCT FROM ${String(imageFingerprintVersion)}
      )`
    : Prisma.empty;

  const remainingRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "products"
    WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
      AND COALESCE("user_front_image_url", "image_url") <> ''
    ${retryableClause}
    ${missingClause}
  `;
  const remainingBefore = Number(remainingRows[0]?.count ?? 0);

  type RebuildRow = {
    id: string;
    imageUrl: string | null;
  };

  const rows = await prisma.$queryRaw<RebuildRow[]>`
    SELECT
      "id",
      COALESCE("user_front_image_url", "image_url") AS "imageUrl"
    FROM "products"
    WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
      AND COALESCE("user_front_image_url", "image_url") <> ''
    ${retryableClause}
    ${missingClause}
    ORDER BY "image_fingerprint_updated_at" ASC NULLS FIRST, "updated_at" DESC
    LIMIT ${limit}
  `;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // Stop early when we are running out of execution time so the function can
  // return a partial result instead of being killed by Vercel timeout.
  const startedAt = Date.now();
  const timeBudgetMs = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  let cancelledForTime = false;

  type Outcome = "updated" | "failed" | "skipped";

  async function processOne(row: RebuildRow): Promise<Outcome> {
    if (!row.imageUrl) return "skipped";

    const fingerprint = await imageFingerprintFromUrl(row.imageUrl);
    if (!fingerprint) {
      try {
        await markProductImageFingerprintFailed(row.id, "image fetch or decode failed");
        return "failed";
      } catch {
        return "skipped";
      }
    }
    try {
      await saveProductImageFingerprint(row.id, fingerprint);
      return "updated";
    } catch {
      return "skipped";
    }
  }

  let cursor = 0;
  async function worker() {
    while (!cancelledForTime) {
      if (Date.now() - startedAt > timeBudgetMs) {
        cancelledForTime = true;
        break;
      }
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) break;

      const result = await processOne(rows[index]!).catch(() => "skipped" as const);
      if (result === "updated") updated += 1;
      else if (result === "failed") failed += 1;
      else skipped += 1;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()),
  );

  const remaining = Math.max(0, remainingBefore - updated - failed);

  return {
    scanned: updated + failed + skipped,
    updated,
    failed,
    skipped,
    clipFailed: 0,
    remaining,
    timedOut: cancelledForTime,
    elapsedMs: Date.now() - startedAt,
  };
}

export const rebuildProductImageSignatures = rebuildProductImageFingerprints;

export async function resetProductImageFingerprintFailures() {
  await ensureProductImageMatchColumns();

  return prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_signature" = "image_signature"
        - 'fingerprintBuildFailed'
        - 'fingerprintBuildFailedReason'
        - 'fingerprintBuildFailedAt',
      "updated_at" = CURRENT_TIMESTAMP
    WHERE COALESCE("image_signature" ->> 'fingerprintBuildFailed', 'false') = 'true'
  `;
}

export async function imageFingerprintFromDataUrl(dataUrl: string) {
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("Image data URL is required.");
  }

  const [, base64] = dataUrl.split(",", 2);

  if (!base64) {
    throw new Error("Image data URL is invalid.");
  }

  return computeImageFingerprintFromBuffer(Buffer.from(base64, "base64"));
}

export async function computeImageFingerprintFromBuffer(
  buffer: Buffer | Uint8Array,
): Promise<ImageFingerprint> {
  const source = Buffer.from(buffer);
  // CLIP embeddings are now computed in the browser via transformers.js
  // and sent to the server separately. Server-side compute is disabled.
  const [normalized, colorHistogram] = await Promise.all([
    normalizeCardImage(source),
    computeColorHistogramFromBuffer(source).catch(() => [] as number[]),
  ]);
  const clipEmbedding: number[] | null = null;
  const ahash = averageHash(normalized.pixels);
  const dhash = differenceHash(normalized.pixels, normalized.width, normalized.height);
  const phash = perceptualHash(normalized.pixels, normalized.width, normalized.height);
  const descriptors = buildOrbLikeDescriptors(
    normalized.pixels,
    normalized.width,
    normalized.height,
  );
  const variantHashes = computeRotationVariantHashes(normalized);

  return {
    fingerprintVersion: imageFingerprintVersion,
    phash,
    dhash,
    ahash,
    width: normalized.width,
    height: normalized.height,
    descriptors,
    colorHistogram,
    variantHashes,
    clipEmbedding: clipEmbedding ?? undefined,
  } satisfies ImageFingerprint;
}

// Fast path used when CONNECTING a card: compute only the cheap perceptual
// hashes (phash/dhash/ahash) and skip the expensive ORB descriptors, color
// histogram, and rotation-variant hashes. The connect response no longer waits
// on ORB/color; the offline fingerprint batch backfills them (it re-processes
// any row whose image_signature has no colorHistogram). Variant hashes are only
// used on the upload side at search time, so a stored card never needs them.
export async function computeQuickHashFingerprintFromBuffer(
  buffer: Buffer | Uint8Array,
): Promise<ImageFingerprint> {
  const normalized = await normalizeCardImage(Buffer.from(buffer));

  return {
    fingerprintVersion: imageFingerprintVersion,
    phash: perceptualHash(normalized.pixels, normalized.width, normalized.height),
    dhash: differenceHash(normalized.pixels, normalized.width, normalized.height),
    ahash: averageHash(normalized.pixels),
    width: normalized.width,
    height: normalized.height,
    // Left empty on purpose → the batch fills descriptors + colorHistogram.
    descriptors: [],
  } satisfies ImageFingerprint;
}

function computeRotationVariantHashes(normalized: NormalizedImage): VariantHashes[] {
  const variants: VariantHashes[] = [];

  for (const angle of [90, 180, 270] as const) {
    const rotated = rotatePixels(normalized, angle);
    variants.push({
      phash: perceptualHash(rotated.pixels, rotated.width, rotated.height),
      dhash: differenceHash(rotated.pixels, rotated.width, rotated.height),
      ahash: averageHash(rotated.pixels),
    });
  }

  return variants;
}

function rotatePixels(
  source: NormalizedImage,
  angle: 90 | 180 | 270,
): NormalizedImage {
  const { pixels, width, height } = source;
  const out = new Uint8Array(pixels.length);

  if (angle === 180) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[(height - 1 - y) * width + (width - 1 - x)] = pixels[y * width + x] ?? 0;
      }
    }
    return { pixels: out, width, height };
  }

  if (angle === 90) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[x * height + (height - 1 - y)] = pixels[y * width + x] ?? 0;
      }
    }
    return { pixels: out, width: height, height: width };
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[(width - 1 - x) * height + y] = pixels[y * width + x] ?? 0;
    }
  }
  return { pixels: out, width: height, height: width };
}

export function hammingDistance(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  let distance = Math.abs(left.length - right.length) * 4;

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.parseInt(left[index] ?? "0", 16);
    const rightValue = Number.parseInt(right[index] ?? "0", 16);

    if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) {
      distance += 4;
    } else {
      distance += nibblePopcount[leftValue ^ rightValue] ?? 4;
    }
  }

  return distance;
}

async function fileToImageDataUrl(file: File, fieldName: string) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${fieldName} must be an image file.`);
  }

  if (file.size > maxProductMatchImageBytes) {
    throw new Error(`${fieldName} must be 2.5MB or smaller.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  return {
    buffer,
    dataUrl: `data:${file.type};base64,${buffer.toString("base64")}`,
  };
}

async function normalizeCardImage(buffer: Buffer): Promise<NormalizedImage> {
  const base = sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: false });

  const raw = await base.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  const crop = detectCardBounds(raw.data, raw.info.width, raw.info.height);
  const normalizedSource = sharp(raw.data, {
    raw: {
      width: raw.info.width,
      height: raw.info.height,
      channels: 1,
    },
  });
  const normalized = await (crop ? normalizedSource.extract(crop) : normalizedSource)
    .resize({ width: normalizedSize, height: normalizedSize, fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    pixels: new Uint8Array(normalized.data),
    width: normalized.info.width,
    height: normalized.info.height,
  };
}

function detectCardBounds(pixels: Buffer, width: number, height: number) {
  const borderValues: number[] = [];
  const sampleEvery = Math.max(1, Math.floor(Math.min(width, height) / 80));

  for (let x = 0; x < width; x += sampleEvery) {
    borderValues.push(pixels[x] ?? 255);
    borderValues.push(pixels[(height - 1) * width + x] ?? 255);
  }

  for (let y = 0; y < height; y += sampleEvery) {
    borderValues.push(pixels[y * width] ?? 255);
    borderValues.push(pixels[y * width + width - 1] ?? 255);
  }

  const background = median(borderValues);
  const threshold = 22;
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixels[y * width + x] ?? background;

      if (Math.abs(value - background) <= threshold) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;

  if (
    cropWidth < width * 0.35 ||
    cropHeight < height * 0.35 ||
    cropWidth > width * 0.98 ||
    cropHeight > height * 0.98
  ) {
    return null;
  }

  const padding = Math.round(Math.min(cropWidth, cropHeight) * 0.02);
  const paddedLeft = Math.max(0, left - padding);
  const paddedTop = Math.max(0, top - padding);
  const paddedRight = Math.min(width - 1, right + padding);
  const paddedBottom = Math.min(height - 1, bottom + padding);

  return {
    left: paddedLeft,
    top: paddedTop,
    width: paddedRight - paddedLeft + 1,
    height: paddedBottom - paddedTop + 1,
  };
}

function averageHash(pixels: Uint8Array) {
  const small = resizeNearest(pixels, normalizedSize, normalizedSize, 8, 8);
  const average = small.reduce((sum, value) => sum + value, 0) / small.length;

  return bitsToHex(small.map((value) => value >= average));
}

function differenceHash(pixels: Uint8Array, width: number, height: number) {
  const small = resizeNearest(pixels, width, height, 9, 8);
  const bits: boolean[] = [];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits.push((small[y * 9 + x] ?? 0) > (small[y * 9 + x + 1] ?? 0));
    }
  }

  return bitsToHex(bits);
}

function perceptualHash(pixels: Uint8Array, width: number, height: number) {
  const size = perceptualHashSize;
  const small = resizeNearest(pixels, width, height, size, size);
  const coefficients: number[] = [];

  for (let v = 0; v < perceptualHashFrequencyCount; v += 1) {
    for (let u = 0; u < perceptualHashFrequencyCount; u += 1) {
      coefficients.push(dctCoefficient(small, size, u, v));
    }
  }

  const medianValue = median(coefficients.slice(1));

  return bitsToHex(coefficients.map((value) => value >= medianValue));
}

function dctCoefficient(values: number[], size: number, u: number, v: number) {
  let sum = 0;
  const horizontalCosines = dctCosineTable[u]!;
  const verticalCosines = dctCosineTable[v]!;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = values[y * size + x] ?? 0;
      sum += pixel * horizontalCosines[x]! * verticalCosines[y]!;
    }
  }

  const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
  const cv = v === 0 ? 1 / Math.sqrt(2) : 1;

  return (2 / size) * cu * cv * sum;
}

function buildOrbLikeDescriptors(
  pixels: Uint8Array,
  width: number,
  height: number,
): OrbDescriptor[] {
  const keypoints = findKeypoints(pixels, width, height);

  return keypoints.map((keypoint) => ({
    x: keypoint.x,
    y: keypoint.y,
    bits: briefDescriptor(pixels, width, height, keypoint.x, keypoint.y),
  }));
}

function findKeypoints(pixels: Uint8Array, width: number, height: number) {
  const candidates: Array<{ x: number; y: number; response: number }> = [];

  for (let y = 12; y < height - 12; y += 6) {
    for (let x = 12; x < width - 12; x += 6) {
      const gx = Math.abs(pixelAt(pixels, width, height, x + 1, y) - pixelAt(pixels, width, height, x - 1, y));
      const gy = Math.abs(pixelAt(pixels, width, height, x, y + 1) - pixelAt(pixels, width, height, x, y - 1));
      const diagonal =
        Math.abs(pixelAt(pixels, width, height, x + 2, y + 2) - pixelAt(pixels, width, height, x - 2, y - 2)) +
        Math.abs(pixelAt(pixels, width, height, x + 2, y - 2) - pixelAt(pixels, width, height, x - 2, y + 2));
      const response = gx * gy + diagonal;

      if (response > 1200) {
        candidates.push({ x, y, response });
      }
    }
  }

  const selected: Array<{ x: number; y: number; response: number }> = [];

  for (const candidate of candidates.sort((left, right) => right.response - left.response)) {
    if (
      selected.length < 128 &&
      selected.every((item) => squaredDistance(item, candidate) > 144)
    ) {
      selected.push(candidate);
    }
  }

  return selected;
}

function briefDescriptor(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const bits = descriptorPairs.map(([left, right]) => {
    const leftValue = pixelAt(pixels, width, height, x + left[0], y + left[1]);
    const rightValue = pixelAt(pixels, width, height, x + right[0], y + right[1]);

    return leftValue > rightValue;
  });

  return bitsToHex(bits);
}

function compareOrbDescriptors(
  uploaded: OrbDescriptor[],
  candidate: OrbDescriptor[],
): MatchSummary {
  if (!uploaded.length || !candidate.length) {
    return {
      orbMatchScore: 0,
      orbMatchCount: 0,
      homographyScore: 0,
      homographyInliers: 0,
    };
  }

  const matches: Array<{ from: OrbDescriptor; to: OrbDescriptor; distance: number }> = [];

  for (const descriptor of uploaded) {
    let best: { descriptor: OrbDescriptor; distance: number } | null = null;
    let secondBest: { descriptor: OrbDescriptor; distance: number } | null = null;

    for (const target of candidate) {
      const distance = hammingDistance(descriptor.bits, target.bits);

      if (!best || distance < best.distance) {
        secondBest = best;
        best = { descriptor: target, distance };
      } else if (!secondBest || distance < secondBest.distance) {
        secondBest = { descriptor: target, distance };
      }
    }

    if (
      best &&
      secondBest &&
      best.distance <= 48 &&
      best.distance / Math.max(1, secondBest.distance) <= 0.82
    ) {
      matches.push({ from: descriptor, to: best.descriptor, distance: best.distance });
    }
  }

  const homographyInliers = estimateInliers(matches);
  const inlierRatio = matches.length ? homographyInliers / matches.length : 0;

  return {
    orbMatchScore: Math.min(1, matches.length / 28),
    orbMatchCount: matches.length,
    homographyScore: Math.min(1, inlierRatio * 1.3),
    homographyInliers,
  };
}

function estimateInliers(
  matches: Array<{ from: OrbDescriptor; to: OrbDescriptor; distance: number }>,
) {
  if (matches.length < 4) {
    return 0;
  }

  const dxValues = matches.map((match) => match.to.x - match.from.x);
  const dyValues = matches.map((match) => match.to.y - match.from.y);
  const medianDx = median(dxValues);
  const medianDy = median(dyValues);

  return matches.filter((match) => {
    const dx = match.to.x - match.from.x;
    const dy = match.to.y - match.from.y;

    return Math.hypot(dx - medianDx, dy - medianDy) <= 32;
  }).length;
}

function hashScoreFromDistance(distance: number) {
  return Math.max(0, Math.min(1, 1 - distance / 64));
}

async function imageFingerprintFromUrl(url: string) {
  try {
    if (url.startsWith("data:image/")) {
      return imageFingerprintFromDataUrl(url);
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    const lengthHeader = response.headers.get("content-length");
    const length = lengthHeader ? Number(lengthHeader) : 0;

    if (length > maxProductMatchImageBytes) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > maxProductMatchImageBytes) {
      return null;
    }

    return computeImageFingerprintFromBuffer(buffer);
  } catch {
    return null;
  }
}

async function saveProductImageFingerprint(productId: string, fingerprint: ImageFingerprint) {
  const signatureSql = imageSignatureUpdateSql(fingerprint);

  await prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_signature" = ${signatureSql},
      "image_phash" = ${fingerprint.phash},
      "image_dhash" = ${fingerprint.dhash},
      "image_ahash" = ${fingerprint.ahash},
      "orb_descriptor_path" = ${"db:image_signature.descriptors"},
      "image_width" = ${fingerprint.width},
      "image_height" = ${fingerprint.height},
      "image_fingerprint_updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${productId}
  `;
}

async function markProductImageFingerprintFailed(productId: string, reason: string) {
  await prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_signature" = COALESCE("image_signature", '{}'::jsonb)
        || jsonb_build_object(
          'fingerprintBuildFailed', true,
          'fingerprintBuildFailedReason', ${reason},
          'fingerprintBuildFailedAt', to_jsonb(CURRENT_TIMESTAMP)
        ),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${productId}
  `;
}

function imageSignatureUpdateSql(fingerprint: ImageFingerprint) {
  const fingerprintJson = JSON.stringify(fingerprint);

  if (fingerprint.clipEmbedding?.length === clipEmbeddingDim) {
    return Prisma.sql`${fingerprintJson}::jsonb`;
  }

  return Prisma.sql`
    ${fingerprintJson}::jsonb ||
    CASE
      WHEN (
        CASE
          WHEN jsonb_typeof("image_signature" -> 'clipEmbedding') = 'array'
          THEN jsonb_array_length("image_signature" -> 'clipEmbedding')
          ELSE 0
        END
      ) = ${clipEmbeddingDim}
      THEN jsonb_build_object('clipEmbedding', "image_signature" -> 'clipEmbedding')
      ELSE '{}'::jsonb
    END
  `;
}

function parseFingerprintJson(value: unknown): ImageFingerprint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.phash !== "string" ||
    typeof record.dhash !== "string" ||
    typeof record.ahash !== "string"
  ) {
    return null;
  }

  const descriptors = Array.isArray(record.descriptors)
    ? record.descriptors
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const descriptor = item as Record<string, unknown>;

          if (
            typeof descriptor.x !== "number" ||
            typeof descriptor.y !== "number" ||
            typeof descriptor.bits !== "string"
          ) {
            return null;
          }

          return {
            x: descriptor.x,
            y: descriptor.y,
            bits: descriptor.bits,
          } satisfies OrbDescriptor;
        })
        .filter((item): item is OrbDescriptor => item !== null)
    : [];

  const colorHistogram = Array.isArray(record.colorHistogram)
    ? record.colorHistogram.filter(
        (item): item is number => typeof item === "number" && Number.isFinite(item),
      )
    : undefined;

  const variantHashes = Array.isArray(record.variantHashes)
    ? record.variantHashes
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const variant = item as Record<string, unknown>;

          if (
            typeof variant.phash !== "string" ||
            typeof variant.dhash !== "string" ||
            typeof variant.ahash !== "string"
          ) {
            return null;
          }

          return {
            phash: variant.phash,
            dhash: variant.dhash,
            ahash: variant.ahash,
          } satisfies VariantHashes;
        })
        .filter((item): item is VariantHashes => item !== null)
    : undefined;

  const clipEmbedding = Array.isArray(record.clipEmbedding)
    ? record.clipEmbedding.filter(
        (item): item is number => typeof item === "number" && Number.isFinite(item),
      )
    : undefined;

  return {
    fingerprintVersion:
      typeof record.fingerprintVersion === "number" ? record.fingerprintVersion : 0,
    phash: record.phash,
    dhash: record.dhash,
    ahash: record.ahash,
    width: typeof record.width === "number" ? record.width : normalizedSize,
    height: typeof record.height === "number" ? record.height : normalizedSize,
    descriptors,
    colorHistogram:
      colorHistogram && colorHistogram.length === colorHistogramBins
        ? colorHistogram
        : undefined,
    variantHashes: variantHashes && variantHashes.length ? variantHashes : undefined,
    clipEmbedding:
      clipEmbedding && clipEmbedding.length === clipEmbeddingDim
        ? clipEmbedding
        : undefined,
  };
}

function resizeNearest(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const output = new Array<number>(targetWidth * targetHeight).fill(0);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((y / Math.max(1, targetHeight - 1)) * (sourceHeight - 1)),
    );

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((x / Math.max(1, targetWidth - 1)) * (sourceWidth - 1)),
      );
      output[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }

  return output;
}

function bitsToHex(bits: boolean[]) {
  let hex = "";

  for (let index = 0; index < bits.length; index += 4) {
    const nibble =
      (bits[index] ? 8 : 0) +
      (bits[index + 1] ? 4 : 0) +
      (bits[index + 2] ? 2 : 0) +
      (bits[index + 3] ? 1 : 0);
    hex += nibble.toString(16);
  }

  return hex;
}

function pixelAt(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const clampedX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(height - 1, Math.round(y)));

  return pixels[clampedY * width + clampedX] ?? 0;
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middle] ?? 0;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function squaredDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function buildDescriptorPairs() {
  const pairs: Array<[[number, number], [number, number]]> = [];
  let seed = 0x9e3779b9;

  for (let index = 0; index < 128; index += 1) {
    const leftX = randomOffset();
    const leftY = randomOffset();
    const rightX = randomOffset();
    const rightY = randomOffset();
    pairs.push([
      [leftX, leftY],
      [rightX, rightY],
    ]);
  }

  return pairs;

  function randomOffset() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;

    return (Math.abs(seed) % 31) - 15;
  }
}

function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function textArraySql(values: string[]) {
  if (!values.length) {
    return Prisma.sql`ARRAY[]::TEXT[]`;
  }

  return Prisma.sql`ARRAY[${Prisma.join(values)}]::TEXT[]`;
}

const nibblePopcount = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
