import { prisma } from "@/lib/prisma";

export const maxProductMatchImageBytes = 2_500_000;
const signatureLength = 64;
const defaultScanLimit = 500;
const lazySignatureLimit = 80;

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
  imageSignature: unknown;
};

export type PreparedProductImages = {
  frontImageUrl: string;
  backImageUrl: string | null;
  frontSignature: number[];
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
};

export type ConfirmProductImageMatchInput = {
  productId: string;
  frontImageUrl: string;
  backImageUrl?: string | null;
  matchConfidence?: number | null;
  matchedBy?: MatchedBy;
  publicBaseUrl?: string | null;
};

export async function ensureProductImageMatchColumns() {
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
      ADD COLUMN IF NOT EXISTS "image_signature" JSONB
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_image_source_idx"
      ON "products" ("image_source")
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "products_verified_at_idx"
      ON "products" ("verified_at")
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
    frontSignature: imageSignatureFromBuffer(front.buffer),
  };
}

export async function findProductImageCandidates(
  uploadedSignature: number[],
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
      "image_signature" AS "imageSignature"
    FROM "products"
    WHERE COALESCE("user_front_image_url", "image_url") IS NOT NULL
      AND COALESCE("user_front_image_url", "image_url") <> ''
    ORDER BY "updated_at" DESC
    LIMIT ${scanLimit}
  `;

  let lazySignatures = 0;
  const candidates: ProductImageCandidate[] = [];

  for (const row of rows) {
    let signature = parseStoredSignature(row.imageSignature);

    if (!signature && row.imageUrl && lazySignatures < lazySignatureLimit) {
      signature = await imageSignatureFromUrl(row.imageUrl);
      lazySignatures += 1;

      if (signature) {
        await saveProductImageSignature(row.id, signature);
      }
    }

    candidates.push({
      id: row.id,
      sku: row.sku,
      productName: row.productName,
      optionName: row.optionName,
      category: row.category,
      brand: row.brand,
      imageUrl: row.imageUrl,
      sourceImageUrl: row.sourceImageUrl,
      similarity: signature ? cosineSimilarity(uploadedSignature, signature) : 0,
    });
  }

  return candidates
    .sort((left, right) => right.similarity - left.similarity)
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

  const frontSignature = imageSignatureFromDataUrl(input.frontImageUrl);
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

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: input.productId },
      data: {
        imageUrl: frontListingImageUrl,
        ebayImageUrls: imageUrls,
      },
    });

    await tx.$executeRaw`
      UPDATE "products"
      SET
        "source_image_url" = COALESCE("source_image_url", ${product.imageUrl}),
        "user_front_image_url" = ${input.frontImageUrl},
        "user_back_image_url" = ${input.backImageUrl ?? null},
        "image_source" = ${"user_uploaded" satisfies ImageSource},
        "has_back_image" = ${Boolean(input.backImageUrl)},
        "matched_by" = ${input.matchedBy ?? "image_similarity"},
        "match_confidence" = ${clampConfidence(input.matchConfidence)},
        "verified_at" = CURRENT_TIMESTAMP,
        "image_signature" = ${JSON.stringify(frontSignature)}::jsonb
      WHERE "id" = ${input.productId}
    `;
  });

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

export async function rebuildProductImageSignatures(limit = 1000) {
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

    const signature = await imageSignatureFromUrl(row.imageUrl);

    if (!signature) {
      skipped += 1;
      continue;
    }

    await saveProductImageSignature(row.id, signature);
    updated += 1;
  }

  return { scanned: rows.length, updated, skipped };
}

export function imageSignatureFromDataUrl(dataUrl: string) {
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("Image data URL is required.");
  }

  const [, base64] = dataUrl.split(",", 2);

  if (!base64) {
    throw new Error("Image data URL is invalid.");
  }

  return imageSignatureFromBuffer(Buffer.from(base64, "base64"));
}

export function imageSignatureFromBuffer(buffer: Buffer | Uint8Array) {
  const bins = new Array<number>(signatureLength).fill(0);

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index] ?? 0;
    bins[(index + byte) % signatureLength] += byte / 255;
    bins[(index * 7 + (byte >> 2)) % signatureLength] += 0.5;
  }

  return normalizeVector(bins);
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return Math.max(0, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
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

async function imageSignatureFromUrl(url: string) {
  try {
    if (url.startsWith("data:image/")) {
      return imageSignatureFromDataUrl(url);
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

    return imageSignatureFromBuffer(buffer);
  } catch {
    return null;
  }
}

async function saveProductImageSignature(productId: string, signature: number[]) {
  await prisma.$executeRaw`
    UPDATE "products"
    SET "image_signature" = ${JSON.stringify(signature)}::jsonb
    WHERE "id" = ${productId}
  `;
}

function parseStoredSignature(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const signature = value
    .map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null))
    .filter((item): item is number => item !== null);

  return signature.length === signatureLength ? signature : null;
}

function normalizeVector(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (!magnitude) {
    return values;
  }

  return values.map((value) => Number((value / magnitude).toFixed(8)));
}

function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}
