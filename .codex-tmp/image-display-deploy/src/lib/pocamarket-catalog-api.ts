import { z } from "zod";

export const catalogGroups = { 2: "BTS", 3: "Stray Kids" } as const;
export type CatalogGroupId = keyof typeof catalogGroups;
const cardSchema = z.object({
  id: z.number().int().positive().safe(),
  name_en: z.string().trim().min(1).max(1000),
  image: z.string().url().refine((url) => url.startsWith("https://")),
  group_name_en: z.string(),
  member_name_en: z.string().trim().min(1).max(100),
  stocked_count: z.number().int().nonnegative().max(2147483647),
});
const pageSchema = z.object({ success: z.literal(true), data: z.object({
  count: z.number().int().nonnegative(),
  next_page: z.number().int().positive().max(5000).nullable(),
  results: z.array(cardSchema).max(100),
}) });
export type CatalogCard = z.infer<typeof cardSchema>;

export function parseCatalogPage(payload: unknown, group: CatalogGroupId, page: number) {
  const parsed = pageSchema.safeParse(payload);
  if (!parsed.success) throw new Error("포카마켓 상품 목록 형식이 변경되어 수집을 멈췄습니다.");
  const data = parsed.data.data;
  if (data.results.some((card) => card.group_name_en.trim().toLowerCase() !== catalogGroups[group].toLowerCase())) {
    throw new Error("선택한 그룹과 다른 상품이 포함되어 수집을 멈췄습니다.");
  }
  if (data.next_page !== null && (data.next_page <= page || !data.results.length)) {
    throw new Error("포카마켓 다음 페이지가 올바르지 않아 수집을 멈췄습니다.");
  }
  return { ...data, results: [...new Map(data.results.map((card) => [card.id, card])).values()] };
}

export async function fetchCatalogPage(group: CatalogGroupId, page: number) {
  const url = new URL("https://pocamarket.com/apis/card/gb/v2/search");
  url.search = new URLSearchParams({ group: String(group), sort: "new", page: String(page) }).toString();
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`포카마켓 상품 목록 HTTP ${response.status}. 잠시 후 다시 시도합니다.`);
  return parseCatalogPage(await response.json(), group, page);
}

export function catalogProductData(card: CatalogCard, group: CatalogGroupId) {
  const names: Record<string, string> = { "RM": "RM", "JIN": "Jin", "SUGA": "SUGA", "J-HOPE": "J-Hope", "JIMIN": "Jimin", "V": "V", "JUNGKOOK": "Jungkook", "BANG CHAN": "Bang Chan", "LEE KNOW": "Lee Know", "CHANGBIN": "Changbin", "HYUNJIN": "Hyunjin", "HAN": "Han", "FELIX": "Felix", "SEUNGMIN": "Seungmin", "I.N": "I.N", "UNIT": "Unit" };
  const brand = catalogGroups[group];
  const optionName = names[card.member_name_en.toUpperCase()] ?? card.member_name_en;
  return { sku: String(card.id), pocamarketId: String(card.id), internalCode: String(card.id),
    brand, category: card.name_en, optionName,
    productName: `${brand} ${card.name_en} ${optionName}`.slice(0, 240),
    imageUrl: card.image, ebayImageUrls: [], stockQuantity: 0, status: "unlisted",
    pocamarketAvailableCount: null, isSoldOut: false,
    // Global USD prices and stock are not the Korean procurement state.
    // Only the existing KRW collector may confirm salePrice and availableCount.
    salePrice: null, pocamarketSyncedAt: null, pocamarketLastAttemptAt: null,
    memo: JSON.stringify({ source: "pocamarket_catalog", groupId: group, sourceUrl: `https://pocamarket.com/search/detail/${card.id}`, discoveredAt: new Date().toISOString(), originalName: card.name_en, globalStockHint: card.stocked_count }),
  };
}

export function nextCatalogRun(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(14, 0, 0, 0); // 23:00 Asia/Seoul
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
