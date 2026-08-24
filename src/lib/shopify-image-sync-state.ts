type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

/**
 * Existing Shopify media is preserved when it predates managed image metadata.
 * A changed watermark setting alone never schedules a repair; only an explicit
 * failed sync or a changed approved source image does.
 */
export function shopifyImageSyncIsCurrent(metadata: unknown, approvedSourceUrl: string) {
  const outer = asRecord(metadata);
  const imageSync = asRecord(outer?.imageSync);
  if (!imageSync) return true;
  if (imageSync.status !== "READY") return false;
  return imageSync.sourceImageUrl === approvedSourceUrl;
}
