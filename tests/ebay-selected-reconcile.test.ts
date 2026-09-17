import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ products: vi.fn(), report: vi.fn(), rows: vi.fn(), logs: vi.fn(), ids: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: mocks.products }, ebayReportImport: { findFirst: mocks.report }, ebayActiveListing: { findMany: mocks.rows }, syncLog: { findMany: mocks.logs }, pricingSettings: { findUnique: mocks.settings } } }));
vi.mock("@/lib/product-operations", () => ({ getOperationalProductIds: mocks.ids }));
import { getEbayFeedOperationTargets } from "@/lib/ebay-feed-operations";
beforeEach(() => {
  vi.clearAllMocks();
  const products = ["p", "other"].map(id => ({ id, sku: id, productName: id, ebayItemId: "item-" + id, stockQuantity: 1, pocamarketAvailableCount: 0, salePrice: null, finalListingPriceUsd: 12 }));
  mocks.ids.mockResolvedValue(["p", "other"]);
  mocks.products.mockResolvedValueOnce([]).mockResolvedValueOnce(products);
  mocks.report.mockResolvedValue({ id: "report" });
  mocks.rows.mockResolvedValue(products.map(p => ({ productId: p.id, itemId: p.ebayItemId, sku: p.sku, price: 12, quantity: 1 })));
  mocks.logs.mockResolvedValue(products.map(p => ({ status: "SUCCESS", rawJson: { productId: p.id, itemId: p.ebayItemId, price: "12", quantity: 1 } })));
  mocks.settings.mockResolvedValue({});
});
it("keeps unchanged automatic targets excluded", async () => {
  expect(await getEbayFeedOperationTargets("admin", "revise", undefined, new Map())).toEqual([]);
});
it("reapplies only explicitly selected products even when stored success/report values match", async () => {
  const targets = await getEbayFeedOperationTargets("admin", "revise", undefined, new Map(), ["p"]);
  expect(targets).toEqual([expect.objectContaining({ productId: "p", itemId: "item-p", price: "12", quantity: 1, useSku: false })]);
});
it("keeps failed actual verification in automatic targets despite an older success and matching report", async () => {
  mocks.logs.mockResolvedValue([
    { status: "FAILED", rawJson: { productId: "p", itemId: "item-p", price: "12", quantity: 1 } },
    ...["p", "other"].map(id => ({ status: "SUCCESS", rawJson: { productId: id, itemId: "item-" + id, price: "12", quantity: 1 } })),
  ]);
  expect(await getEbayFeedOperationTargets("admin", "revise", undefined, new Map())).toEqual([expect.objectContaining({ productId: "p", quantityChanged: true })]);
});
