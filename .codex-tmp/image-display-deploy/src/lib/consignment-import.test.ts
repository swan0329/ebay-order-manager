import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), createMany: vi.fn(), movements: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { importConsignmentRows, normalizeConsignmentRow } from "./consignment-import";
const row = { "상품번호": "123", "그룹명": "BTS", "앨범명": "Proof", "멤버": "Jin", "재고": "14", "보유 재고": "2", "ebay item id": "123456789", "ebay 스캔 item id": "987654321", "이미지_승인상태": "approved" };
describe("consignment import", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(callback => callback({product:{findMany:mocks.findMany,createMany:mocks.createMany},inventoryMovement:{createMany:mocks.movements}}));
  });
  it("keeps dry runs read only", async () => {
    expect(await importConsignmentRows({rows:[row],source:"source",dryRun:true},"admin")).toMatchObject({created:0,candidates:1});
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.movements).not.toHaveBeenCalled();
  });
  it("skips existing identities on retry without changing inventory", async () => {
    mocks.findMany.mockResolvedValue([{sku:"other",pocamarketId:"123"}]);
    expect(await importConsignmentRows({rows:[row],source:"source",dryRun:false},"admin")).toMatchObject({created:0,skipped:1});
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.movements).not.toHaveBeenCalled();
  });
  it("saves stock history in the same transaction and propagates failure", async () => {
    mocks.movements.mockRejectedValue(new Error("history failed"));
    await expect(importConsignmentRows({rows:[row],source:"source",dryRun:false},"admin")).rejects.toThrow("history failed");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.movements).toHaveBeenCalledWith({data:[expect.objectContaining({quantity:2,beforeQuantity:0,afterQuantity:2,createdBy:"admin"})]});
  });
  it("separates owned stock from supply and leaves live sync unconfirmed", () => {
    expect(normalizeConsignmentRow(row,"source")).toMatchObject({ sku:"123", pocamarketId:"123", stockQuantity:2, pocamarketAvailableCount:14, pocamarketSyncedAt:null, salePrice:null });
  });
  it("does not infer owned inventory from supplier quantity", () => {
    expect(normalizeConsignmentRow({...row,"보유 재고":""},"source").stockQuantity).toBe(0);
  });
  it("preserves conflicting legacy listing IDs and original image approval", () => {
    const p=normalizeConsignmentRow(row,"source");
    expect(JSON.parse(p.memo)).toMatchObject({legacyEbayIds:["123456789","987654321"], importedRow:{"이미지_승인상태":"approved"}});
    expect(p).not.toHaveProperty("listingStatus");
  });
  it("never expands rounded scientific notation into an eBay item ID", () => {
    const p=normalizeConsignmentRow({...row,"ebay item id":"3.06789E+11","ebay 스캔 item id":""},"source");
    expect(p.ebayItemId).toBeNull();
    expect(JSON.parse(p.memo).legacyEbayIds).toEqual(["3.06789E+11"]);
    expect(p.uploadErrorSummary).toContain("정밀도 손실");
  });
  it.each(["-1","1.2","NaN"])("rejects invalid inventory %s", value => {
    expect(()=>normalizeConsignmentRow({...row,"보유 재고":value},"source")).toThrow();
  });
});
