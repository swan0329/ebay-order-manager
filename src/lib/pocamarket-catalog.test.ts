import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), txQuery: vi.fn(), txExecute: vi.fn(), find: vi.fn(), create: vi.fn(), fetch: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute, $transaction: m.transaction } }));
vi.mock("@/lib/pocamarket-catalog-api", async (original) => ({ ...await original<typeof import("./pocamarket-catalog-api")>(), fetchCatalogPage: m.fetch }));
import { runCatalogChunk, continueCatalogScan } from "./pocamarket-catalog";
const card = { id: 123, name_en: "Album", group_name_en: "BTS", member_name_en: "Jin", image: "https://images.example/card.jpg", stocked_count: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  m.query.mockResolvedValueOnce([{ group_id: 2, next_page: 7 }]).mockResolvedValue([{ count: 0 }]);
  m.txQuery.mockResolvedValue([{ group_id: 2 }]);
  m.find.mockResolvedValue([]); m.create.mockResolvedValue({ count: 1 });
  m.execute.mockResolvedValue(1); m.txExecute.mockResolvedValue(1);
  m.fetch.mockResolvedValue({ count: 1, next_page: null, results: [card] });
  m.transaction.mockImplementation((fn) => fn({ $queryRaw: m.txQuery, $executeRaw: m.txExecute, product: { findMany: m.find, createMany: m.create } }));
});
describe("catalogue persistence", () => {
  it("leaves remaining work to the scheduler instead of recursively invoking HTTP routes", async () => {
    m.query.mockReset().mockResolvedValueOnce([{ group_id: 2, next_page: 7 }]).mockResolvedValue([{ count: 1 }]);
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);
    vi.stubEnv("CRON_SECRET", "test-secret");
    try {
      await continueCatalogScan();
      expect(m.fetch).toHaveBeenCalledWith(2, 7);
      expect(outbound).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("resumes the saved cursor and creates only unapproved products with zero owned inventory", async () => {
    await expect(runCatalogChunk()).resolves.toMatchObject({ created: 1, processedPages: 1 });
    expect(m.fetch).toHaveBeenCalledWith(2, 7);
    expect(m.create.mock.calls[0][0].data[0]).toMatchObject({ sku: "123", stockQuantity: 0, salePrice: null, ebayImageUrls: [] });
    expect(m.txExecute).toHaveBeenCalledTimes(3);
  });
  it("preserves existing images, prices and inventory when SKU or supplier ID is already linked", async () => {
    m.find.mockResolvedValue([{ sku: "custom-123", pocamarketId: "123" }]);
    await expect(runCatalogChunk()).resolves.toMatchObject({ created: 0 });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.txExecute).toHaveBeenCalledTimes(1);
  });
  it("does not write products after the lease is lost or a pause is requested", async () => {
    m.txQuery.mockResolvedValue([]);
    await expect(runCatalogChunk()).resolves.toMatchObject({ created: 0, failed: true });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("backs off after a supplier failure without advancing the cursor", async () => {
    m.fetch.mockRejectedValue(new Error("포카마켓 상품 목록 HTTP 429"));
    await expect(runCatalogChunk()).resolves.toMatchObject({ failed: true, processedPages: 0 });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.execute).toHaveBeenCalledTimes(2);
  });
});
