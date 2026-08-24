import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findDrafts = vi.hoisted(() => vi.fn());
const countDrafts = vi.hoisted(() => vi.fn());
const findProducts = vi.hoisted(() => vi.fn());
const findOrderItems = vi.hoisted(() => vi.fn());
const findPricingSettings = vi.hoisted(() => vi.fn());
const planInventory = vi.hoisted(() => vi.fn());
const readyImages = vi.hoisted(() => vi.fn());
const ebayImageRepairs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { listingDraft: { findMany: findDrafts, count: countDrafts }, product: { findMany: findProducts }, orderItem: { findMany: findOrderItems }, pricingSettings: { findUnique: findPricingSettings } } }));
vi.mock("@/lib/services/ebayInventoryPush", () => ({ planEbayInventoryPush: planInventory }));
vi.mock("@/lib/listing-price", () => ({ resolveListingPriceUsd: (product: { ebayPrice?: number | null }) => ({ priceUsd: product.ebayPrice ?? 10 }) }));
vi.mock("@/lib/variation-listing-products", () => ({ getVariationListingReadyImages: readyImages, withVariationListingMetadata: async <T,>(products: T[]) => products }));
vi.mock("@/lib/services/ebayVariationImageRepair", () => ({ listEbayVariationImageRepairs: ebayImageRepairs }));

const { getEbayOperations, getShopifyOperations } = await import("@/lib/services/ebayOperations");

describe("eBay operations classification", () => {
  beforeEach(() => { vi.clearAllMocks(); findDrafts.mockResolvedValue([]); countDrafts.mockResolvedValue(0); findProducts.mockResolvedValue([]); findOrderItems.mockResolvedValue([]); findPricingSettings.mockResolvedValue({}); readyImages.mockResolvedValue([]); ebayImageRepairs.mockResolvedValue([]); });

  it("separates changed and sold-out listings", async () => {
    planInventory.mockResolvedValue({ missingPrice: [], rows: [
      { productId:"changed",sku:"A",productName:"A card",productStatus:"active",itemId:"1",stock:2,reserved:0,quantity:2,price:12,previousQuantity:1,previousPrice:10,listingType:"SINGLE",parentTitle:null,availabilityStatus:"AVAILABLE",actionable:true },
      { productId:"same",sku:"B",productName:"B card",productStatus:"active",itemId:"2",stock:1,reserved:0,quantity:1,price:10,previousQuantity:1,previousPrice:10,listingType:"SINGLE",parentTitle:null,availabilityStatus:"AVAILABLE",actionable:true },
      { productId:"sold",sku:"C",productName:"C card",productStatus:"active",itemId:"3",stock:0,reserved:0,quantity:0,price:10,previousQuantity:1,previousPrice:10,listingType:"SINGLE",parentTitle:null,availabilityStatus:"SOLD_OUT",actionable:true },
    ] });
    const result = await getEbayOperations("user");
    expect(result.change.map(row => row.productId)).toEqual(["changed"]);
    expect(result.unavailable.map(row => [row.productId,row.reason])).toEqual([["sold","단품 품절"]]);
    expect(result.summary).toMatchObject({ unavailableOptions: 0, unavailableSingles: 1 });
  });

  it("counts Shopify bundles as listings instead of counting every option as a product", async () => {
    const common = { imageUrl: "https://img.test/card.jpg", ebayImageUrls: [], stockQuantity: 1, safetyStock: 0, status: "active", isSoldOut: false, pocamarketAvailableCount: 0, pocamarketSyncedAt: new Date(), shopifyProductId: null, productListings: [], ebayPrice: 10 };
    findProducts.mockResolvedValue([
      { ...common, id: "a", sku: "A", brand: "SKZ", category: "Album", productName: "SKZ Album POB A", optionName: "A" },
      { ...common, id: "b", sku: "B", brand: "SKZ", category: "Album", productName: "SKZ Album POB B", optionName: "B" },
      { ...common, id: "c", sku: "C", brand: "SKZ", category: null, productName: "Single", optionName: "C" },
    ]);
    readyImages.mockResolvedValue(["a", "b", "c"].map((id) => ({ id, listingImageUrl: `https://img.test/${id}.jpg` })));
    const result = await getShopifyOperations();
    expect(result.create).toHaveLength(2);
    expect(result.summary).toMatchObject({ shopifyListings: 2, shopifyVariationListings: 1, shopifySingleListings: 1, shopifyOptions: 3 });
    expect(result.create[0]).toMatchObject({ listingType: "VARIATION", optionCount: 2, productIds: ["a", "b"] });
  });

  it("keeps a sold-out variation as an option update instead of ending its parent", async () => {
    planInventory.mockResolvedValue({ missingPrice: [], rows: [
      { productId:"option",sku:"OPT-1",productName:"Option",productStatus:"active",itemId:"parent",stock:0,reserved:0,quantity:0,price:12,previousQuantity:1,previousPrice:12,listingType:"VARIATION_OPTION",parentTitle:"Bundle",availabilityStatus:"SOLD_OUT",actionable:true },
    ] });
    const result = await getEbayOperations("user");
    expect(result.unavailable[0]).toMatchObject({ itemId: "parent", sku: "OPT-1", reason: "옵션 품절", listingType: "VARIATION_OPTION" });
    expect(result.summary).toMatchObject({ unavailableOptions: 1, unavailableSingles: 0 });
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
