import type { Product } from "@/generated/prisma";

export type ProductImageExtras = {
  sourceImageUrl?: string | null;
  userFrontImageUrl?: string | null;
  userBackImageUrl?: string | null;
  // Comma-separated real members for "unit" cards (e.g. "Lee Know, I.N").
  featuredMembers?: string | null;
};

// Parses the stored featured-members text into a clean list of member names.
export function parseFeaturedMembers(value: unknown): string[] {
  return String(value ?? "")
    .split(/[,/|·、]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

// The member name(s) to show on a listing: the explicit featured members win
// (so "unit" cards list the real members) and fall back to the option name.
function memberDisplay(product: {
  optionName?: string | null;
  featuredMembers?: string | null;
}): string {
  const members = parseFeaturedMembers(product.featuredMembers);
  if (members.length) {
    return members.join(" ");
  }
  return titleCaseName(product.optionName);
}

export type EbayListingFieldProduct = ProductImageExtras &
  Pick<
    Product,
    | "brand"
    | "category"
    | "descriptionHtml"
    | "ebayCategoryId"
    | "ebayCondition"
    | "ebayImageUrls"
    | "ebayPrice"
    | "ebayTitle"
    | "imageUrl"
    | "memo"
    | "optionName"
    | "productName"
    | "salePrice"
    | "sku"
    | "stockQuantity"
  >;

const groupAliases = new Map<string, string>([
  ["stray kids", "SKZ"],
  ["stray-kids", "SKZ"],
  ["skz", "SKZ"],
]);

const uppercaseAlbums = new Map<string, string>([
  ["oddinary", "ODDINARY"],
  ["maxident", "MAXIDENT"],
  ["noeasy", "NOEASY"],
  ["go live", "GO LIVE"],
  ["in life", "IN LIFE"],
  ["5-star", "5-STAR"],
  ["5star", "5-STAR"],
  ["rock-star", "ROCK-STAR"],
  ["rockstar", "ROCK-STAR"],
]);

export const DEFAULT_EBAY_PHOTOCARD_CATEGORY_ID = "108857";
export const DEFAULT_EBAY_PHOTOCARD_CATEGORY_NAME = "Other Music Memorabilia";
export const DEFAULT_EBAY_CONDITION_ID = "1000";

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// eBay item specific(상품 세부정보) 값은 항목당 최대 65자. 초과하면 업로드가 거부된다.
export const EBAY_ITEM_SPECIFIC_MAX_LENGTH = 65;

function clampAspectValue(value: string, max = EBAY_ITEM_SPECIFIC_MAX_LENGTH) {
  if (value.length <= max) {
    return value;
  }

  const hardCut = value.slice(0, max);
  const lastSpace = hardCut.lastIndexOf(" ");

  // 단어 중간이 잘리지 않도록, 한도 안쪽 충분히 뒤쪽에 공백이 있으면 거기서 자른다.
  if (lastSpace >= Math.floor(max * 0.6)) {
    return hardCut.slice(0, lastSpace).trim();
  }

  return hardCut.trim();
}

function normalizedKey(value: unknown) {
  return text(value).toLowerCase();
}

function uniqueTexts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const item = text(value);
    const key = item.toLowerCase();

    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

function titleCaseName(value: unknown) {
  return text(value)
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => {
          if (!part) return part;
          if (/^[A-Z0-9.]{1,3}$/.test(part)) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("-"),
    )
    .join(" ");
}

function albumTitle(value: unknown) {
  const album = text(value);
  const mapped = uppercaseAlbums.get(album.toLowerCase());
  return mapped ?? album;
}

function groupAlias(brand: unknown) {
  const alias = groupAliases.get(normalizedKey(brand));
  const brandText = text(brand);

  if (!alias || alias.toLowerCase() === brandText.toLowerCase()) {
    return "";
  }

  return alias;
}

function trimTitle(value: string) {
  const title = text(value);
  if (title.length <= 80) {
    return title;
  }

  return title.slice(0, 80).replace(/\s+\S*$/, "").trim() || title.slice(0, 80).trim();
}

// 앨범/이벤트명이 길 때 사용. 접두(그룹·멤버 등)와 접미(Photocard 등) 키워드는
// 그대로 두고, 앨범명만 80자 안에 남는 공간에 맞춰 단어 단위로 줄인다.
function fitAlbumIntoTitle(
  prefixTokens: Array<string | null | undefined>,
  album: string,
  suffixTokens: Array<string | null | undefined>,
  max = 80,
) {
  const prefix = uniqueTexts(prefixTokens).join(" ");
  const suffix = uniqueTexts(suffixTokens).join(" ");
  const fixedLength = prefix.length + (suffix ? suffix.length + 1 : 0);
  const albumBudget = max - fixedLength - (album ? 1 : 0);

  if (!album || albumBudget <= 0) {
    return uniqueTexts([prefix, suffix]).join(" ");
  }

  const fittedAlbum = clampAspectValue(album, albumBudget);
  return uniqueTexts([prefix, fittedAlbum, suffix]).join(" ");
}

function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
  };

  return value.replace(/[<>&]/g, (char) => replacements[char] ?? char);
}

export function buildEbayListingTitle(product: EbayListingFieldProduct) {
  const brand = text(product.brand);
  const alias = groupAlias(brand);
  const member = memberDisplay(product);
  const album = albumTitle(product.category);
  const fallback = text(product.ebayTitle) || text(product.productName);

  if ((!brand && !member && !album) || (!member && !album && fallback)) {
    return trimTitle(fallback);
  }

  const suffix = "Photocard";
  // Richer variants (with the "Kpop" search keyword) come first; the builder
  // falls back to shorter ones when a variant would exceed eBay's 80-char limit.
  const variants = [
    uniqueTexts([brand, alias, member, "Official", album, suffix, "Kpop"]).join(" "),
    uniqueTexts([brand, member, "Official", album, suffix, "Kpop"]).join(" "),
    uniqueTexts([brand, alias, member, "Official", album, suffix]).join(" "),
    uniqueTexts([brand, member, "Official", album, suffix]).join(" "),
    uniqueTexts([brand, alias, member, album, suffix]).join(" "),
    uniqueTexts([brand, member, album, suffix]).join(" "),
  ].map(text).filter(Boolean);

  const fitted = variants.find((variant) => variant.length <= 80);
  if (fitted) {
    return fitted;
  }

  // 어떤 변형도 80자를 넘으면(앨범/이벤트명이 김), 핵심 키워드는 보장하고
  // 앨범명만 남는 공간에 맞춰 줄인다. → "Photocard"가 절대 빠지지 않게.
  const budgeted =
    fitAlbumIntoTitle([brand, alias, member, "Official"], album, [suffix, "Kpop"]) ||
    fitAlbumIntoTitle([brand, member, "Official"], album, [suffix]) ||
    fitAlbumIntoTitle([brand, member], album, [suffix]);

  return trimTitle(budgeted || variants[0] || fallback);
}

export function buildEbayListingDescription(product: EbayListingFieldProduct) {
  const description = text(product.descriptionHtml);
  if (description) {
    return product.descriptionHtml ?? description;
  }

  const memo = text(product.memo);
  if (memo) {
    return memo;
  }

  const title = buildEbayListingTitle(product);
  return `<p>${escapeHtml(title)}</p>`;
}

function absoluteUrl(value: unknown, baseUrl?: string | null) {
  const url = text(value);
  if (!url || /^data:/i.test(url)) {
    return "";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const base =
    text(baseUrl) ||
    text(process.env.R2_PUBLIC_BASE_URL) ||
    text(process.env.CLOUDFLARE_R2_PUBLIC_URL) ||
    text(process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL);

  if (!base) {
    return "";
  }

  if (url.startsWith("/")) {
    return `${base.replace(/\/+$/, "")}${url}`;
  }

  return `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

export function buildEbayListingImageUrls(
  product: EbayListingFieldProduct,
  baseUrl?: string | null,
) {
  const hasRawUserFrontImage = Boolean(text(product.userFrontImageUrl));
  const userFrontImage = absoluteUrl(product.userFrontImageUrl, baseUrl);
  const userBackImage = absoluteUrl(product.userBackImageUrl, baseUrl);
  const userImages = uniqueTexts([userFrontImage, userBackImage]);

  if (userFrontImage) {
    return userImages;
  }

  const ebayImages = uniqueTexts(
    (product.ebayImageUrls ?? []).map((url) => absoluteUrl(url, baseUrl)),
  );

  if (hasRawUserFrontImage) {
    const currentImages = uniqueTexts([absoluteUrl(product.imageUrl, baseUrl), userBackImage]);

    if (currentImages.length) {
      return currentImages;
    }
  }

  if (ebayImages.length) {
    return ebayImages;
  }

  return uniqueTexts([
    absoluteUrl(product.imageUrl, baseUrl),
    absoluteUrl(product.sourceImageUrl, baseUrl),
  ]);
}

export function buildEbayListingItemSpecifics(product: EbayListingFieldProduct) {
  return {
    Brand: clampAspectValue(text(product.brand)),
    Type: "Photocard",
    "Featured Person/Artist": clampAspectValue(memberDisplay(product)),
    Artist: clampAspectValue(memberDisplay(product)),
    Franchise: clampAspectValue(text(product.brand)),
    Set: clampAspectValue(albumTitle(product.category)),
    Genre: "K-Pop",
    "Country/Region of Manufacture": "South Korea",
    "Original/Reproduction": "Original",
  };
}

export function buildEbayListingItemSpecificArrays(product: EbayListingFieldProduct) {
  const specifics = buildEbayListingItemSpecifics(product);

  return Object.fromEntries(
    Object.entries(specifics)
      .map(([key, value]) => [key, text(value) ? [text(value)] : []] as const)
      .filter(([, values]) => values.length),
  );
}

export function buildEbayListingCategoryId(
  product: { ebayCategoryId?: string | null },
  fallback = DEFAULT_EBAY_PHOTOCARD_CATEGORY_ID,
) {
  return text(product.ebayCategoryId) || fallback;
}

export function buildEbayListingCategoryName(
  product: { ebayCategoryId?: string | null },
  fallback = DEFAULT_EBAY_PHOTOCARD_CATEGORY_NAME,
) {
  const categoryId = buildEbayListingCategoryId(product);

  if (categoryId === DEFAULT_EBAY_PHOTOCARD_CATEGORY_ID) {
    return fallback;
  }

  return "";
}

export function buildEbayListingConditionId(
  product: { ebayCondition?: string | null },
  fallback = DEFAULT_EBAY_CONDITION_ID,
) {
  const condition = text(product.ebayCondition).toUpperCase();

  if (/^\d+$/.test(condition)) {
    return condition;
  }

  if (["NEW", "NEW_WITH_TAGS"].includes(condition)) {
    return "1000";
  }

  if (["LIKE_NEW", "NEW_OTHER"].includes(condition)) {
    return "1500";
  }

  if (["USED", "PREOWNED", "PRE-OWNED"].includes(condition)) {
    return "3000";
  }

  return fallback;
}

export function buildEbayListingPrice(product: EbayListingFieldProduct) {
  // salePrice is the PocaMarket KRW source price and must not become a USD
  // upload price. Approved recommendations are copied to ListingDraft.price.
  const price = product.ebayPrice;
  if (price === null || price === undefined) {
    return "";
  }

  const numeric = Number(price);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : text(price);
}

export function hasPocamarketPrice(product: Pick<EbayListingFieldProduct, "salePrice">) {
  if (product.salePrice === null || product.salePrice === undefined) return false;
  const numeric = Number(product.salePrice);
  return Number.isFinite(numeric) && numeric > 0;
}
