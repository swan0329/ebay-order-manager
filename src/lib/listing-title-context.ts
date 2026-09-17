const clean = (value?: string | null) => (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function withoutLeadingBrand(value: string, brand: string) {
  if (!brand) return value;
  return value.replace(new RegExp(`^(?:${escape(brand)}\\s+)+`, "iu"), "")
    .replace(new RegExp(`\\s*[:|]\\s*${escape(brand)}$`, "iu"), "").trim();
}

// Display-only normalization. Preserve saved variation keys and membership.
export function listingAlbumContext(brandValue?: string | null, albumValue?: string | null, versionValue?: string | null) {
  const brand = clean(brandValue);
  const album = withoutLeadingBrand(clean(albumValue), brand);
  let version = withoutLeadingBrand(clean(versionValue), brand);
  if (!album) return version;
  if (!version) return album;
  const phrase = (value: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, "iu");
  if (phrase(version).test(album)) return album;
  version = version.replace(phrase(album), " ").replace(/\s+/g, " ")
    .replace(/^[\s:|/·_-]+|[\s:|/·_-]+$/g, "").trim();
  return [album, version].filter(Boolean).join(" ");
}
