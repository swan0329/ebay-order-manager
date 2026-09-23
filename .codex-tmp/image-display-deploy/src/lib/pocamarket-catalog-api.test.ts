import { describe, expect, it } from "vitest";
import { catalogProductData, nextCatalogRun, parseCatalogPage } from "./pocamarket-catalog-api";
const card = { id: 505706, name_en: "dominate HMV", group_name_en: "Stray Kids", member_name_en: "CHANGBIN", image: "https://images.example/card.jpg", stocked_count: 1, price: "10.50" };
const payload = { success: true, data: { count: 1, next_page: null, results: [card] } };
describe("Pocamarket catalogue boundary", () => {
  it("normalizes only the selected group and does not treat USD as KRW or approve its image", () => {
    const parsed = parseCatalogPage(payload, 3, 1);
    expect(catalogProductData(parsed.results[0], 3)).toMatchObject({ sku: "505706", pocamarketId: "505706", brand: "Stray Kids", optionName: "Changbin", stockQuantity: 0, salePrice: null, pocamarketAvailableCount: null, pocamarketSyncedAt: null, ebayImageUrls: [] });
  });
  it("rejects other groups, broken schemas and looping pages", () => {
    expect(() => parseCatalogPage(payload, 2, 1)).toThrow("다른 상품");
    expect(() => parseCatalogPage({ success: false }, 3, 1)).toThrow("형식");
    expect(() => parseCatalogPage({ ...payload, data: { ...payload.data, next_page: 1 } }, 3, 1)).toThrow("다음 페이지");
  });
  it("deduplicates repeated IDs without inventing another SKU", () => {
    expect(parseCatalogPage({ ...payload, data: { ...payload.data, results: [card, card] } }, 3, 1).results).toHaveLength(1);
  });
  it("schedules the next 23:00 Korea run without rerunning a finished daily scan", () => {
    expect(nextCatalogRun(new Date("2026-09-08T06:00:00Z")).toISOString()).toBe("2026-09-08T14:00:00.000Z");
    expect(nextCatalogRun(new Date("2026-09-08T14:01:00Z")).toISOString()).toBe("2026-09-09T14:00:00.000Z");
  });
});
