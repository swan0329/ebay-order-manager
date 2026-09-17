const maxProductSearchTerms = 100;

export function normalizeProductSearchTerm(value: string) {
  const term = value.trim();
  try {
    const url = new URL(term);
    if (/(^|\.)ebay\.(com|co\.uk|com\.au|de|fr|it|es|ca)$/i.test(url.hostname)) {
      const item = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:\/|$)/)?.[1] ?? url.searchParams.get("item");
      if (item && /^\d{9,15}$/.test(item)) return item;
    }
  } catch { /* Ordinary keywords and SKUs are not URLs. */ }
  return term;
}

export function parseProductSearchTerms(value?: string | null) {
  const terms = (value ?? "")
    .split(/\r?\n/)
    .map(normalizeProductSearchTerm)
    .filter(Boolean);
  const seen = new Set<string>();

  return terms.filter((term) => {
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxProductSearchTerms);
}

export function serializeProductSearchTerms(terms: string[]) {
  return parseProductSearchTerms(terms.join("\n")).join("\n");
}
