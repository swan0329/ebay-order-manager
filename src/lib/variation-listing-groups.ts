export type VariationProduct = {
  id: string;
  sku: string;
  brand: string | null;
  category: string | null;
  productName: string;
  optionName: string | null;
  imageUrl: string | null;
  ebayImageUrls?: string[];
};

export type VariationListingGroup<T extends VariationProduct = VariationProduct> = {
  key: string;
  groupName: string;
  albumName: string;
  versionName: string;
  title: string;
  products: Array<T & { variationName: string }>;
};

function clean(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function comparable(value: string) {
  return clean(value).normalize("NFKC").toLocaleLowerCase("en");
}

function removeText(source: string, value: string | null | undefined) {
  const needle = clean(value);
  if (!needle) return source;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(
    new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"),
    " ",
  );
}

export function variationVersionName(product: VariationProduct) {
  let version = clean(product.productName);
  version = removeText(version, product.brand);
  version = removeText(version, product.category);
  version = removeText(version, product.optionName);
  return version
    .replace(/\b(?:official|photocard|photo card|poca|kpop)\b/giu, " ")
    .replace(/[|/·_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFor(groupName: string, albumName: string, versionName: string) {
  const parts = [groupName, albumName, versionName];
  return [...new Set(parts.map(clean).filter(Boolean))].join(" ").slice(0, 80);
}

export function variationEbayTitle(title: string) {
  const base = clean(title);
  if (/\b(?:photocard|photo card)\b/iu.test(base)) return base.slice(0, 80).trim();
  const suffix = " Photocard";
  return `${base.slice(0, 80 - suffix.length).trim()}${suffix}`;
}

function uniqueVariationNames<T extends VariationProduct>(products: T[]) {
  const used = new Map<string, number>();
  return products.map((product) => {
    const member = clean(product.optionName) || "Card";
    const count = (used.get(comparable(member)) ?? 0) + 1;
    used.set(comparable(member), count);
    return { ...product, variationName: count === 1 ? member : `${member} ${count}` };
  });
}

/**
 * Product data already stores group, album and version/source separately as
 * brand, category and productName. Exact normalized matches are intentional:
 * a false merge is much harder to undo than leaving one card as a single.
 */
export function buildVariationListingGroups<T extends VariationProduct>(products: T[]) {
  const buckets = new Map<string, T[]>();
  const unmatched: T[] = [];

  for (const product of products) {
    const groupName = clean(product.brand);
    const albumName = clean(product.category);
    const versionName = variationVersionName(product);
    const hasImage = Boolean(clean(product.imageUrl) || product.ebayImageUrls?.some(Boolean));
    if (!groupName || !albumName || !hasImage) {
      unmatched.push(product);
      continue;
    }
    const key = [groupName, albumName, versionName].map(comparable).join("\u001f");
    const rows = buckets.get(key) ?? [];
    rows.push(product);
    buckets.set(key, rows);
  }

  const groups: VariationListingGroup<T>[] = [];
  for (const [key, rows] of buckets) {
    if (rows.length < 2) {
      unmatched.push(...rows);
      continue;
    }
    rows.sort((a, b) =>
      clean(a.optionName).localeCompare(clean(b.optionName), "ko", { numeric: true }) ||
      a.sku.localeCompare(b.sku, "en", { numeric: true }),
    );
    const groupName = clean(rows[0].brand);
    const albumName = clean(rows[0].category);
    const versionName = variationVersionName(rows[0]);
    groups.push({
      key,
      groupName,
      albumName,
      versionName,
      title: titleFor(groupName, albumName, versionName),
      products: uniqueVariationNames(rows),
    });
  }

  groups.sort((a, b) =>
    b.products.length - a.products.length || a.title.localeCompare(b.title, "en"),
  );
  unmatched.sort((a, b) => a.sku.localeCompare(b.sku, "en", { numeric: true }));
  return { groups, unmatched };
}

export function relationshipDetails(group: VariationListingGroup) {
  return `Card=${group.products.map((product) => product.variationName.replace(/[;|=]/g, " ")).join(";")}`;
}

export function variationParentSku(key: string) {
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `VAR-${(hash >>> 0).toString(36).toUpperCase()}`;
}
