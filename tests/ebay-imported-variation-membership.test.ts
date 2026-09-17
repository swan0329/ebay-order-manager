import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({
  variationListingState: { findMany: vi.fn() },
  ebayReportImport: { findFirst: vi.fn() },
  ebayActiveListing: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { getEbayVariationMembershipByProductId } from "@/lib/variation-listing-products";
import { buildEbayFeedXml } from "@/lib/ebay-feed-xml";
beforeEach(() => {
  vi.clearAllMocks();
  db.variationListingState.findMany.mockResolvedValue([]);
  db.ebayReportImport.findFirst.mockResolvedValue({ id: "report" });
  db.ebayActiveListing.findMany.mockResolvedValue([{ itemId: "parent", sku: "a" }, { itemId: "parent", sku: "b" }]);
  db.product.findMany.mockResolvedValue([{ id: "p", ebayItemId: "parent", sku: "a" }]);
});
it("includes the exact SKU when revising imported options without a saved group", async () => {
  const membership = await getEbayVariationMembershipByProductId("admin");
  expect(membership.get("p")).toBe("parent");
  const xml = buildEbayFeedXml("revise", [{ productId: "p", productName: "card", itemId: "parent", sku: "a", useSku: membership.has("p"), quantity: 0 }]);
  expect(xml).toContain("<SKU>a</SKU>");
  expect(xml).toContain("<Quantity>0</Quantity>");
  expect(db.ebayReportImport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "admin" } }));
});
it("preserves explicit saved membership and does not infer a different link from SKU alone", async () => {
  db.variationListingState.findMany.mockResolvedValue([{ ebayItemId: "saved", includedProductIds: ["p"] }]);
  db.product.findMany.mockResolvedValue([{ id: "p", ebayItemId: "parent", sku: "a" }, { id: "wrong", ebayItemId: "other", sku: "a" }]);
  expect([...await getEbayVariationMembershipByProductId("admin")]).toEqual([["p", "saved"]]);
});
it("does not classify single listings or ambiguous duplicate rows as options", async () => {
  db.ebayActiveListing.findMany.mockResolvedValue([{ itemId: "parent", sku: "a" }, { itemId: "parent", sku: "a" }]);
  expect((await getEbayVariationMembershipByProductId("admin")).size).toBe(0);
  db.ebayActiveListing.findMany.mockResolvedValue([{ itemId: "parent", sku: "a" }, { itemId: "parent", sku: "a" }, { itemId: "parent", sku: "b" }]);
  expect((await getEbayVariationMembershipByProductId("admin")).size).toBe(0);
});
