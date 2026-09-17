import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn(), filters: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiUser: m.user, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: m.find } } }));
vi.mock("@/lib/products", () => ({ matchesProductStockFilter: () => true, createProduct: vi.fn(), productInputSchema: {} }));
vi.mock("@/lib/product-search-where", () => ({ productSearchWhere: m.filters }));
import { GET } from "@/app/api/products/route";
import { UnauthorizedError } from "@/lib/session";
beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({id:"admin"}); m.find.mockResolvedValue([]); m.filters.mockResolvedValue({brand:"BTS"}); });
it("uses exact SKU membership and preserves all other filters", async () => {
  expect((await GET(new Request("https://example.test/api/products?skus=296333,284272&group=BTS"))).status).toBe(200);
  expect(m.find).toHaveBeenCalledWith(expect.objectContaining({where:{AND:[{brand:"BTS"},{sku:{in:["296333","284272"]}}]},take:500}));
  expect(m.filters).toHaveBeenCalledWith(expect.objectContaining({group:"BTS"}),"admin");
});
it.each(["",Array.from({length:501},(_,i)=>String(i)).join(",")])("rejects invalid or oversized exact queries before database access",async skus=>{
  expect((await GET(new Request("https://example.test/api/products?skus="+skus))).status).toBe(422);
  expect(m.find).not.toHaveBeenCalled();
});
it("denies an unauthorized audit before reading product data", async () => {
  m.user.mockRejectedValue(new UnauthorizedError());
  expect((await GET(new Request("https://example.test/api/products?skus=296333"))).status).toBe(401);
  expect(m.find).not.toHaveBeenCalled();
});
it("keeps ordinary keyword search behavior", async () => {
  await GET(new Request("https://example.test/api/products?q=Suga"));
  expect(m.find.mock.calls[0][0].where).toEqual({brand:"BTS"});
});
