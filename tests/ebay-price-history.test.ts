import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const find = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { ebayFeedJob: { findMany: find } } }));
import { listEbayFeedJobs } from "@/lib/ebay-feed-operations";
it("queries older matching SKU jobs within the current account and returns stored price evidence", async () => {
  find.mockResolvedValueOnce([{ id:"job", targetsJson:[{productId:"p",sku:"296333",itemId:"item",price:"10.6",quantity:1}],failuresJson:[],failureCount:0,createdAt:new Date("2026-09-12") }]);
  const result=await listEbayFeedJobs("admin","296333");
  expect(find).toHaveBeenLastCalledWith({where:{userId:"admin",targetsJson:{array_contains:[{sku:"296333"}]}},orderBy:{createdAt:"desc"},take:100});
  expect(result[0].targets[0]).toMatchObject({sku:"296333",price:"10.6",quantity:1});
});
it("preserves the normal recent-history limit", async () => {
  find.mockResolvedValueOnce([]);
  await listEbayFeedJobs("admin");
  expect(find).toHaveBeenLastCalledWith({where:{userId:"admin"},orderBy:{createdAt:"desc"},take:20});
});
