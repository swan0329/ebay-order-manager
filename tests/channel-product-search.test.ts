import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ states: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { variationListingState: { findMany: mocks.states } } }));
import { productSearchWhere } from "@/lib/product-search-where";
import { parseProductSearchTerms } from "@/lib/product-search";
import { matchesVariationGroupSearch } from "@/lib/variation-group-search";

describe("channel identifiers in inventory search", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.states.mockResolvedValue([]); });
  it("resolves owned saved membership without applying the current sellability filter", async () => {
    mocks.states.mockResolvedValue([{ includedProductIds: ["sold-out-card", "active-card"], pendingProductIds: ["active-card", "pending-card", 5], ebayItemId: "158183489442" }]);
    const where = await productSearchWhere({ q: " var-wr1u63 ", group: "Stray Kids", stock: "sold_out" }, "admin");
    expect(mocks.states).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "admin", OR: [{ parentSku: { contains: "var-wr1u63", mode: "insensitive" } }] } }));
    expect(where.AND).toEqual(expect.arrayContaining([
      { stockQuantity: { lte: 0 } },
      { brand: { startsWith: "Stray Kids", mode: "insensitive" } },
      { OR: expect.arrayContaining([
        { id: { in: ["sold-out-card", "active-card", "pending-card"] } },
        { ebayItemId: { in: ["158183489442"] } },
      ]) },
    ]));
  });
  it("searches direct item IDs too when there is no saved group", async () => {
    const where = await productSearchWhere({ q: "https://www.ebay.com/itm/Some-Title/158183489442?var=1" }, "admin");
    expect(where.AND).toEqual([{ OR: expect.arrayContaining([{ ebayItemId: { contains: "158183489442", mode: "insensitive" } }]) }]);
    expect(mocks.states).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "admin", OR: [{ ebayItemId: "158183489442" }] } }));
  });
  it("does not query group state for ordinary keywords or lose mixed search terms", async () => {
    await productSearchWhere({ q: "421031\nPLVE" }, "admin");
    expect(mocks.states).not.toHaveBeenCalled();
    const where = await productSearchWhere({ q: "VAR-WR1U63\n421031" }, "admin");
    expect(where.AND).toEqual([{ OR: expect.arrayContaining([{ sku: { contains: "421031", mode: "insensitive" } }]) }]);
  });
  it("only extracts item numbers from eBay URLs and deduplicates equivalent inputs", () => {
    expect(parseProductSearchTerms("https://www.ebay.com/itm/158183489442\n158183489442")).toEqual(["158183489442"]);
    expect(parseProductSearchTerms("https://ebay.com.fake.test/itm/158183489442")).toEqual(["https://ebay.com.fake.test/itm/158183489442"]);
  });
});
describe("variation group search", () => {
  const group = { key: "key", parentSku: "VAR-WR1U63", title: "Stray Kids DO IT PLVE", ebayItemId: "158183489442", products: [{ sku: "421031", variationName: "Bang Chan" }] };
  it.each(["var-wr1u63", " VAR-WR1 ", "158183489442", "https://www.ebay.com/itm/158183489442", "421031", "Bang Chan", "PLVE"])("finds the same group by %s", query => {
    expect(matchesVariationGroupSearch(group, query)).toBe(true);
  });
  it("rejects unrelated identifiers", () => expect(matchesVariationGroupSearch(group, "VAR-UNKNOWN")).toBe(false));
});
