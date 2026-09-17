import { describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(async (input) => input), products: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: m.products },
  pocamarketSyncBatch: { findFirst: vi.fn(async () => null), create: m.create },
  pocamarketSyncSettings: { upsert: vi.fn(async () => ({ priorityStrategy: "SMART" })) } } }));
vi.mock("@/lib/ai-image-work", () => ({ reconcileAiImageJobsForSupply: vi.fn() }));
import { createPocamarketSyncBatch } from "@/lib/pocamarket-sync";
describe("new catalogue price collection", () => {
  it("limits a BTS-only batch to BTS in the database query before selecting its size", async () => {
    m.products.mockClear();
    m.products.mockResolvedValue([{ id: "bts", pocamarketId: "123", salePrice: null, pocamarketLastAttemptAt: null, pocamarketSyncedAt: null }]);
    await createPocamarketSyncBatch("admin", 10000, { group: "BTS" });
    expect(m.products).toHaveBeenCalledWith(expect.objectContaining({ where: { pocamarketId: { not: null }, brand: "BTS" } }));
  });
  it("does not starve unpriced BTS/new cards behind previously refreshed products", async () => {
    m.products.mockResolvedValue([
      { id: "old", pocamarketId: "1", salePrice: 1000, pocamarketLastAttemptAt: new Date(), pocamarketSyncedAt: new Date() },
      { id: "new", pocamarketId: "2", salePrice: null, pocamarketLastAttemptAt: null, pocamarketSyncedAt: null },
    ]);
    await createPocamarketSyncBatch("admin", 1);
    expect(m.create.mock.calls.at(-1)![0].data.items.create[0].productId).toBe("new");
  });
});

it("prioritizes ordered cards then selling procurement cards over older unlisted inventory", async () => {
  const stale = new Date(Date.now() - 2 * 86400000);
  m.products.mockResolvedValue([
    { id: "unlisted", pocamarketId: "1", salePrice: 1000, pocamarketSyncedAt: null, pocamarketLastAttemptAt: null },
    { id: "selling", pocamarketId: "2", salePrice: 1000, stockQuantity: 0, ebayItemId: "ebay", pocamarketSyncedAt: stale, pocamarketLastAttemptAt: stale },
    { id: "ordered", pocamarketId: "3", salePrice: 1000, stockQuantity: 0, orderItems: [{ id: "order" }], pocamarketSyncedAt: stale, pocamarketLastAttemptAt: stale },
  ]);
  await createPocamarketSyncBatch("admin", 2);
  expect(m.create.mock.calls.at(-1)![0].data.items.create.map((item: { productId: string }) => item.productId)).toEqual(["ordered", "selling"]);
});
it("rolling refresh excludes fresh listings and backs off recent failures", async () => {
  const stale = new Date(Date.now() - 2 * 86400000);
  m.products.mockResolvedValue([
    { id: "due", pocamarketId: "1", stockQuantity: 0, ebayItemId: "ebay", listingStatus: "ACTIVE", pocamarketSyncedAt: stale, pocamarketLastAttemptAt: stale },
    { id: "fresh", pocamarketId: "2", stockQuantity: 0, ebayItemId: "ebay", listingStatus: "ACTIVE", pocamarketSyncedAt: new Date(), pocamarketLastAttemptAt: new Date() },
    { id: "backoff", pocamarketId: "3", stockQuantity: 0, ebayItemId: "ebay", listingStatus: "ACTIVE", pocamarketSyncedAt: stale, pocamarketLastAttemptAt: new Date() },
    { id: "ended", pocamarketId: "4", stockQuantity: 0, ebayItemId: "ebay", listingStatus: "ENDED", pocamarketSyncedAt: stale, pocamarketLastAttemptAt: stale },
  ]);
  await createPocamarketSyncBatch("admin", 250, { activeOnly: true });
  expect(m.create.mock.calls.at(-1)![0].data.items.create.map((item: { productId: string }) => item.productId)).toEqual(["due"]);
});
