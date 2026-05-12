import sharp from "sharp";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export const maxProductMatchImageBytes = 2_500_000;

const normalizedSize = 512;
const hashCandidateLimit = 30;
const defaultScanLimit = 3000;
const lazyFingerprintLimit = 80;
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
  imageFingerprint: unknown;
};

export type OrbDescriptor = {
  x: number;
  y: number;
  bits: string;
};

export type ImageFingerprint = {
  phash: string;
  dhash: string;
  ahash: string;
  width: number;
  height: number;
  descriptors: OrbDescriptor[];
};

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
      ADD COLUMN IF NOT EXISTS "image_source" TEXT NOT NULL DEFAULT 'pocamarket',
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
      ADD COLUMN IF NOT EXISTS "image_fingerprint_updated_at" TIMESTAMP(3)
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

export async function findProductImageCandidates(
  uploadedFingerprint: ImageFingerprint,
  options: { limit?: number; scanLimit?: number } = {},
): Promise<ProductImageCandidate[]> {
  await ensureProductImageMatchColumns();

  const scanLimit = options.scanLimit ?? defaultScanLimit;
  const limit = options.limit ?? 10;
  const rows = await prisma.$queryRaw<ProductImageRow[]>`
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
      "image_signature" AS "imageFingerprint"
    FROM "products"
    WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
      AND COALESCE("user_front_image_url", "image_url") <> ''
    ORDER BY "image_fingerprint_updated_at" DESC NULLS LAST, "updated_at" DESC
    LIMIT ${scanLimit}
  `;

  let lazyFingerprints = 0;
  const hashCandidates: Array<{
    row: ProductImageRow;
    fingerprint: ImageFingerprint;
    hashDistance: number;
    hashScore: number;
  }> = [];

  for (const row of rows) {
    let fingerprint = parseStoredFingerprint(row);

    if (!fingerprint && row.imageUrl && lazyFingerprints < lazyFingerprintLimit) {
      fingerprint = await imageFingerprintFromUrl(row.imageUrl);
      lazyFingerprints += 1;

      if (fingerprint) {
        await saveProductImageFingerprint(row.id, fingerprint);
      }
    }

    if (!fingerprint) {
      continue;
    }

    const hashDistance = combinedHashDistance(uploadedFingerprint, fingerprint);
    hashCandidates.push({
      row,
      fingerprint,
      hashDistance,
      hashScore: hashScoreFromDistance(hashDistance),
    });
  }

  return hashCandidates
    .sort((left, right) => left.hashDistance - right.hashDistance)
    .slice(0, hashCandidateLimit)
    .map(({ row, fingerprint, hashDistance, hashScore }) => {
      const featureMatch = compareOrbDescriptors(
        uploadedFingerprint.descriptors,
        fingerprint.descriptors,
      );
      const finalScore =
        hashScore * 0.35 +
        featureMatch.orbMatchScore * 0.45 +
        featureMatch.homographyScore * 0.2;

      return {
        id: row.id,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        category: row.category,
        brand: row.brand,
        imageUrl: row.imageUrl,
        sourceImageUrl: row.sourceImageUrl,
        similarity: finalScore,
        finalScore,
        hashScore,
        hashDistance,
        orbMatchScore: featureMatch.orbMatchScore,
        orbMatchCount: featureMatch.orbMatchCount,
        homographyScore: featureMatch.homographyScore,
        homographyInliers: featureMatch.homographyInliers,
        groupName: row.brand,
        memberName: row.optionName,
        albumName: row.category,
        versionName: row.productName,
        existingImageUrl: row.imageUrl,
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, limit);
}

export async function confirmProductImageMatch(input: ConfirmProductImageMatchInput) {
  await ensureProductImageMatchColumns();

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, imageUrl: true },
  });

  if (!product) {
    throw new Error("Product not found.");
  }

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

export async function rebuildProductImageFingerprints(limit = 1000) {
  await ensureProductImageMatchColumns();

  const rows = await prisma.$queryRaw<Array<{ id: string; imageUrl: string | null }>>`
    SELECT
      "id",
      COALESCE("user_front_image_url", "image_url") AS "imageUrl"
    FROM "products"
    WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
      AND COALESCE("user_front_image_url", "image_url") <> ''
    ORDER BY "updated_at" DESC
    LIMIT ${limit}
  `;

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.imageUrl) {
      skipped += 1;
      continue;
    }

    const fingerprint = await imageFingerprintFromUrl(row.imageUrl);

    if (!fingerprint) {
      skipped += 1;
      continue;
    }

    await saveProductImageFingerprint(row.id, fingerprint);
    updated += 1;
  }

  return { scanned: rows.length, updated, skipped };
}

export const rebuildProductImageSignatures = rebuildProductImageFingerprints;

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

export async function computeImageFingerprintFromBuffer(buffer: Buffer | Uint8Array) {
  const normalized = await normalizeCardImage(Buffer.from(buffer));
  const ahash = averageHash(normalized.pixels);
  const dhash = differenceHash(normalized.pixels, normalized.width, normalized.height);
  const phash = perceptualHash(normalized.pixels, normalized.width, normalized.height);
  const descriptors = buildOrbLikeDescriptors(
    normalized.pixels,
    normalized.width,
    normalized.height,
  );

  return {
    phash,
    dhash,
    ahash,
    width: normalized.width,
    height: normalized.height,
    descriptors,
  } satisfies ImageFingerprint;
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
  const size = 32;
  const small = resizeNearest(pixels, width, height, size, size);
  const coefficients: number[] = [];

  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      coefficients.push(dctCoefficient(small, size, u, v));
    }
  }

  const medianValue = median(coefficients.slice(1));

  return bitsToHex(coefficients.map((value) => value >= medianValue));
}

function dctCoefficient(values: number[], size: number, u: number, v: number) {
  let sum = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = values[y * size + x] ?? 0;
      sum +=
        pixel *
        Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)) *
        Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
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

function combinedHashDistance(left: ImageFingerprint, right: ImageFingerprint) {
  return (
    hammingDistance(left.phash, right.phash) * 0.45 +
    hammingDistance(left.dhash, right.dhash) * 0.35 +
    hammingDistance(left.ahash, right.ahash) * 0.2
  );
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
  await prisma.$executeRaw`
    UPDATE "products"
    SET
      "image_signature" = ${JSON.stringify(fingerprint)}::jsonb,
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

function parseStoredFingerprint(row: ProductImageRow) {
  const parsed = parseFingerprintJson(row.imageFingerprint);

  if (parsed) {
    return parsed;
  }

  if (row.imagePhash && row.imageDhash && row.imageAhash) {
    return {
      phash: row.imagePhash,
      dhash: row.imageDhash,
      ahash: row.imageAhash,
      width: normalizedSize,
      height: normalizedSize,
      descriptors: [],
    } satisfies ImageFingerprint;
  }

  return null;
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

  return {
    phash: record.phash,
    dhash: record.dhash,
    ahash: record.ahash,
    width: typeof record.width === "number" ? record.width : normalizedSize,
    height: typeof record.height === "number" ? record.height : normalizedSize,
    descriptors,
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
