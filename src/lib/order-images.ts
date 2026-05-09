type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function imageUrlFromImageObject(value: unknown) {
  const record = asRecord(value);
  return asString(record.imageUrl) ?? asString(record.url);
}

function firstImageUrlFromArray(value: unknown) {
  return (
    asArray(value)
      .map(imageUrlFromImageObject)
      .find((url): url is string => Boolean(url)) ?? null
  );
}

export function imageUrlFromBrowseItemPayload(value: unknown): string | null {
  const record = asRecord(value);
  const product = asRecord(record.product);

  return (
    imageUrlFromImageObject(record.image) ??
    firstImageUrlFromArray(record.thumbnailImages) ??
    firstImageUrlFromArray(record.additionalImages) ??
    imageUrlFromImageObject(product.image) ??
    firstImageUrlFromArray(product.additionalImages)
  );
}

export function orderItemImageUrlFromRaw(value: unknown): string | null {
  const record = asRecord(value);
  const direct =
    asString(record.soldImageUrl) ??
    asString(record.ebayListingImageUrl) ??
    asString(record.listingImageUrl) ??
    asString(record.imageUrl) ??
    asString(record.thumbnailImageUrl) ??
    asString(record.pictureUrl) ??
    asString(record.galleryURL);

  if (direct) {
    return direct;
  }

  const soldImage = asRecord(record.soldImage);
  const image = asRecord(record.image);
  const product = asRecord(record.product);

  return (
    imageUrlFromImageObject(soldImage) ??
    imageUrlFromImageObject(image) ??
    firstImageUrlFromArray(record.thumbnailImages) ??
    firstImageUrlFromArray(record.additionalImages) ??
    imageUrlFromImageObject(product.image) ??
    firstImageUrlFromArray(product.additionalImages)
  );
}
