import { listingAlbumContext } from "@/lib/listing-title-context";
type Card = { brand?: string | null; category?: string | null; productName?: string | null; optionName?: string | null; sku: string; featuredMembers?: string | null };
const rosters: Record<string, string[]> = {
  bts: ["RM", "Jin", "SUGA", "J-Hope", "Jimin", "V", "Jungkook"],
  "stray kids": ["Bang Chan", "Lee Know", "Changbin", "Hyunjin", "Han", "Felix", "Seungmin", "I.N"],
};
const clean = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
export function cardMembers(value?: string | null) {
  const seen = new Set<string>();
  return (value ?? "").split(/[,/|·、]+/).map(clean).filter(name => {
    const key = name.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function cardGroupLabel(card: Card) {
  const members = cardMembers(card.featuredMembers);
  const key = clean(card.brand).toLowerCase().replace(/-/g, " ");
  const roster = rosters[key === "skz" ? "stray kids" : key];
  return roster && members.length === roster.length && roster.every(name => members.some(member => member.toLowerCase() === name.toLowerCase()))
    ? `Group OT${roster.length}` : null;
}
function remove(source: string, value?: string | null) {
  const escaped = clean(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped ? source.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), " ") : source;
}
function context(card: Card) {
  let version = remove(remove(remove(clean(card.productName), card.category), card.brand), card.optionName);
  for (const member of cardMembers(card.featuredMembers)) version = remove(version, member);
  version = clean(version.replace(/\b(?:official|photocard|photo card|kpop|unit)\b/gi, " "));
  return clean(listingAlbumContext(card.brand, card.category, version).replace(/\bphoto\s*card\b/gi, " "));
}
function fit(value: string, budget: number) {
  if (value.length <= budget) return value;
  // Keep both the album prefix and the version/card suffix when shortening is unavoidable.
  const left = Math.floor((budget - 3) * .65);
  const right = budget - 3 - left;
  return `${value.slice(0, left).replace(/\s+\S*$/, "").trim()} … ${value.slice(-right).replace(/^\S*\s+/, "").trim()}`.slice(0, budget);
}
export function unitCardOption(card: Card) {
  const members = cardMembers(card.featuredMembers);
  if (members.length < 2) return null;
  const label = cardGroupLabel(card) ?? members.join(" + ");
  const code = `#${clean(card.sku).slice(0, 20)}`;
  return `${label} ${code}`.length <= 65 ? `${label} ${code}` : `Unit ${code}`;
}
export function unitCardTitle(card: Card) {
  const members = cardMembers(card.featuredMembers);
  if (members.length < 2) return null;
  const brand = clean(card.brand).slice(0, 24);
  const album = context(card);
  const group = cardGroupLabel(card);
  const named = clean(`${brand} ${album} ${members.join(" ")} Official Photocard`);
  if (!group && named.length <= 80) return named;
  const suffix = `${group ?? "Unit"} Photocard #${clean(card.sku).slice(0, 20)}`;
  const budget = 80 - brand.length - suffix.length - 2;
  return clean(`${brand} ${fit(album, Math.max(0, budget))} ${suffix}`);
}
const html = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function unitMembersDescription(card: Card) {
  const members = cardMembers(card.featuredMembers);
  return members.length < 2 ? "" : `<p><strong>Members pictured:</strong> ${html(members.join(", "))}</p>`;
}
export function variationMembersDescription(cards: Array<Card & { variationName: string }>) {
  const rows = cards.filter(card => cardMembers(card.featuredMembers).length > 1);
  return rows.length ? `<h3>Unit / Group card options</h3><ul>${rows.map(card => `<li>${html(card.variationName)}: ${html(cardMembers(card.featuredMembers).join(", "))}</li>`).join("")}</ul>` : "";
}
