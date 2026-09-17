function cleanExternalId(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/[/?#]/)
    .filter(Boolean)
    .at(-1) ?? "";
}

export function ebayListingUrl(itemId: string | null | undefined) {
  const normalized = cleanExternalId(itemId);
  return /^\d+$/.test(normalized) ? `https://www.ebay.com/itm/${normalized}` : null;
}

export function normalizeShopifyStoreHandle(
  storeDomain: string | null | undefined,
) {
  const cleaned = String(storeDomain ?? "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) return null;

  const withProtocol = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : `https://${cleaned}`;

  try {
    const hostname = new URL(withProtocol).hostname;
    const handle = hostname.split(".")[0]?.replace(/^\uFEFF/, "").trim();
    return handle || null;
  } catch {
    const handle = cleaned.split(/[./]/)[0]?.replace(/^\uFEFF/, "").trim();
    return handle || null;
  }
}

export function shopifyAdminProductUrl(
  storeDomain: string | null | undefined,
  productId: string | null | undefined,
) {
  const storeHandle = normalizeShopifyStoreHandle(storeDomain);
  const normalizedProductId = cleanExternalId(productId);
  if (!storeHandle || !/^\d+$/.test(normalizedProductId)) return null;

  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/products/${normalizedProductId}`;
}
