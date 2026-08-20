import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findDrafts = vi.hoisted(() => vi.fn());
const countDrafts = vi.hoisted(() => vi.fn());
const findProducts = vi.hoisted(() => vi.fn());
const planInventory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { listingDraft: { findMany: findDrafts, count: countDrafts }, product: { findMany: findProducts }, pricingSettings: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/lib/services/ebayInventoryPush", () => ({ planEbayInventoryPush: planInventory }));

const { getEbayOperations } = await import("@/lib/services/ebayOperations");

describe("eBay operations classification", () => {
  beforeEach(() => { vi.clearAllMocks(); findDrafts.mockResolvedValue([]); countDrafts.mockResolvedValue(0); findProducts.mockResolvedValue([]); });

  it("separates changed and sold-out listings", async () => {
    planInventory.mockResolvedValue({ missingPrice: [], rows: [
      { productId:"changed",sku:"A",productName:"A card",productStatus:"active",itemId:"1",stock:2,reserved:0,quantity:2,price:12,previousQuantity:1,previousPrice:10 },
      { productId:"same",sku:"B",productName:"B card",productStatus:"active",itemId:"2",stock:1,reserved:0,quantity:1,price:10,previousQuantity:1,previousPrice:10 },
      { productId:"sold",sku:"C",productName:"C card",productStatus:"active",itemId:"3",stock:0,reserved:0,quantity:0,price:10,previousQuantity:1,previousPrice:10 },
    ] });
    const result = await getEbayOperations("user");
    expect(result.change.map(row => row.productId)).toEqual(["changed"]);
    expect(result.unavailable.map(row => [row.productId,row.reason])).toEqual([["sold","품절"]]);
  });

  it("keeps only the newest draft per product", async () => {
    findDrafts.mockResolvedValue([
      { id:"new",sourceInventoryId:"p",sku:"A",title:"new",price:10,quantity:1,status:"validated",errorSummary:null,updatedAt:new Date() },
      { id:"old",sourceInventoryId:"p",sku:"A",title:"old",price:9,quantity:1,status:"validated",errorSummary:null,updatedAt:new Date(0) },
    ]);
    planInventory.mockResolvedValue({ missingPrice: [], rows: [] });
    const result = await getEbayOperations("user");
    expect(result.create).toHaveLength(1);
    expect(result.create[0].id).toBe("new");
    expect(findDrafts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "validated" }) }));
  });

  it("reports unvalidated drafts separately instead of calling them ready", async () => {
    countDrafts.mockResolvedValue(27);
    planInventory.mockResolvedValue({ missingPrice: [], rows: [] });
    const result = await getEbayOperations("user");
    expect(result.create).toEqual([]);
    expect(result.summary).toMatchObject({ createReady: 0, createNeedsReview: 27 });
  });
});
