import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const apiMock = vi.hoisted(() => vi.fn());
const defaultsMock = vi.hoisted(() => vi.fn());
const productInputMock = vi.hoisted(() => vi.fn());
const inventoryPayloadMock = vi.hoisted(() => vi.fn());
const existingNamesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ebay-existing-variation-names", () => ({ readExistingVariationNames: existingNamesMock, ensureLegacyListingSku: vi.fn() }));
vi.mock("@/lib/services/listingDraftService", () => ({ resolveAutomaticListingDefaults: defaultsMock }));
const prismaMock = vi.hoisted(() => ({
  pricingSettings: { findUnique: vi.fn() },
  listingTemplate: { findFirst: vi.fn() },
  variationListingState: { findUnique: vi.fn(), upsert: vi.fn() },
  product: { updateMany: vi.fn() },
  $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/listing-price", () => ({
  resolveListingPriceUsd: () => ({ priceUsd: { toFixed: () => "12.00" } }),
}));
vi.mock("@/lib/listing-quantity", () => ({ listingQuantity: () => 1 }));
vi.mock("@/lib/variation-thumbnail-prepare", () => ({
  ensureVariationThumbnail: () => Promise.resolve({ url: "https://img/group.jpg", hash: "hash", reused: false }),
}));
vi.mock("@/lib/listing-source-images", () => ({
  prepareProductChannelImages: (_userId: string, product: object) => Promise.resolve({
    ...product,
    ebayImageUrls: ["https://img/central-watermarked.jpg"],
  }),
}));
vi.mock("@/lib/services/ebayApiService", () => ({
  getActiveEbayInventoryAccount: () => Promise.resolve({ id: "account" }),
  ebayApiRequest: apiMock,
}));
vi.mock("@/lib/services/listingService", async (original) => ({
  ...await original<typeof import("@/lib/services/listingService")>(),
  productToListingInput: productInputMock,
  inventoryItemPayload: inventoryPayloadMock,
  offerPayload: (input: unknown) => input,
}));

function mockProductInput(product: { sku: string }) { return ({
    sku: product.sku,
    title: product.sku,
    descriptionHtml: "<p>description</p>",
    price: "10.00",
    quantity: 1,
    imageUrls: ["https://img/card.jpg"],
    categoryId: "183454",
    condition: "NEW",
    shippingProfile: "ship",
    returnProfile: "return",
    paymentProfile: "payment",
    merchantLocationKey: "location",
    marketplaceId: "EBAY_US",
    currency: "USD",
    itemSpecifics: {},
  }); }

import { publishEbayVariationGroup } from "@/lib/ebay-variation-publish";
import { EbayApiError } from "@/lib/ebay";
import { PublishContinuationError } from "@/lib/channel-publish-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  productInputMock.mockImplementation(mockProductInput);
  inventoryPayloadMock.mockImplementation((input: unknown) => input);
  existingNamesMock.mockResolvedValue(new Map());
  defaultsMock.mockResolvedValue({
    automaticDefaults: { categoryId: "108857", shippingProfile: "ship", returnProfile: "return", paymentProfile: "payment", merchantLocationKey: "location", marketplaceId: "EBAY_US", currency: "USD" },
    activeLocationKeys: new Set(["location"]),
  });
  prismaMock.pricingSettings.findUnique.mockResolvedValue({ id: "default" });
  prismaMock.listingTemplate.findFirst.mockResolvedValue({
    descriptionTemplateHtml: "<h2>{{title}}</h2><p>{{sku}} / {{price}}</p>",
  });
  prismaMock.variationListingState.findUnique.mockResolvedValue(null);
  prismaMock.variationListingState.upsert.mockResolvedValue({});
  prismaMock.product.updateMany.mockResolvedValue({ count: 2 });
});

describe("eBay 옵션 직접등록", () => {
  it.each([true,false])("25013 뒤 저장된 옵션을 재조회해서 일치할 때만 복구를 계속한다 (%s)",async(persisted)=>{
    const group=importedBtsGroup();
    prismaMock.variationListingState.findUnique.mockResolvedValue({ebayItemId:'158183489451',includedProductIds:group.products.map(p=>p.id)});
    existingNamesMock.mockResolvedValue(new Map([['100284','Jimin'],['100285','Jin']]));
    const conflict=new EbayApiError('conflict',400,{errors:[{errorId:25013}]});
    let groupBody: unknown={},groupWrites=0;
    const cards=new Map<string,string[]>();
    apiMock.mockImplementation((_account,r)=>{
      if(r.path.includes('/inventory_item_group/')) {
        if(r.method==='PUT') {groupBody=r.body;if(++groupWrites===1)return Promise.reject(conflict);return Promise.resolve({body:{}});}
        return Promise.resolve({body:persisted?groupBody:{}});
      }
      if(r.path.includes('/inventory_item/')) {
        if(r.method==='PUT'){cards.set(r.path,r.body.itemSpecifics.Card);return Promise.reject(conflict);}
        return Promise.resolve({body:{product:{aspects:{Card:cards.get(r.path)}}}});
      }
      return Promise.resolve({body:r.path.includes('publish_by_inventory_item_group')?{listingId:'158183489451'}:r.method==='POST'?{offerId:'offer'}:{offers:[]}});
    });
    if(persisted) await expect(publishEbayVariationGroup('user-1',group as never)).resolves.toMatchObject({listingId:'158183489451'});
    else { await expect(publishEbayVariationGroup('user-1',group as never)).rejects.toBe(conflict);expect(apiMock.mock.calls.some(([,r])=>r.path.includes('publish_by_inventory_item_group'))).toBe(false); }
  });
  it("offer 생성 응답에 ID가 없어도 SKU 조회로 복구하고 중복 생성하지 않는다", async () => {
    const created = new Set<string>();
    apiMock.mockImplementation((_account, input) => {
      if (input.method === 'POST' && input.path.endsWith('/offer')) { created.add(input.body.sku); return Promise.resolve({body:{}}); }
      if (input.path.endsWith('/offer')) return Promise.resolve({body:{offers:created.has(input.query.sku)?[{offerId:'offer-'+input.query.sku}]:[]}});
      return Promise.resolve({body:input.path.includes('publish_by_inventory_item_group')?{listingId:'recovered-group'}:{}});
    });
    await expect(publishEbayVariationGroup('user-1',importedBtsGroup() as never)).resolves.toMatchObject({listingId:'recovered-group'});
    expect(apiMock.mock.calls.filter(([,r])=>r.method==='POST'&&r.path.endsWith('/offer'))).toHaveLength(2);
  });
  it("기존 판매 옵션명은 신규 표시 규칙으로 바꾸지 않고 카드와 묶음에 동일하게 전송한다", async () => {
    const group = importedBtsGroup();
    prismaMock.variationListingState.findUnique.mockResolvedValue({ ebayItemId: "158183489451", includedProductIds: group.products.map(p => p.id) });
    existingNamesMock.mockResolvedValue(new Map([["100284", "CHANGBIN, LEE KNOW"]]));
    apiMock.mockImplementation((_account, input) => Promise.resolve({ body:
      input.path.includes("publish_by_inventory_item_group") ? { listingId: "158183489451" }
      : input.method === "POST" && input.path.endsWith("/offer") ? { offerId: "offer" }
      : { offers: [] },
    }));
    await publishEbayVariationGroup("user-1", group as never);
    const requests = apiMock.mock.calls.map(([, request]) => request);
    expect(requests.findIndex(r=>r.method==='PUT'&&r.path.includes('/inventory_item_group/'))).toBeLessThan(requests.findIndex(r=>r.method==='PUT'&&r.path.includes('/inventory_item/')));
    expect(requests.find(r => r.method === "PUT" && r.path.endsWith("/inventory_item/100284")).body.itemSpecifics.Card).toEqual(["CHANGBIN, LEE KNOW"]);
    expect(requests.find(r => r.method === "PUT" && r.path.includes("/inventory_item_group/")).body.variesBy.specifications[0].values).toContain("CHANGBIN, LEE KNOW");
  });
  it.each([
    "2017 BTS LIVE TRILOGY EPISODE III THE WINGS TOUR in Japan MINI PHOTO CARD VER.2",
    "Stray Kids 2nd World Tour MANIAC ENCORE in JAPAN SAITAMA SUPER ARENA",
  ])("긴 Set 값을 개별 카드와 묶음 양쪽에서 제한한다: %s", async (albumName) => {
    const group = { ...importedBtsGroup(), albumName };
    const actual = await vi.importActual<typeof import("@/lib/services/listingService")>("@/lib/services/listingService");
    inventoryPayloadMock.mockImplementation(actual.inventoryItemPayload);
    productInputMock.mockImplementation((product) => ({ ...mockProductInput(product), itemSpecifics: { Set: [albumName] } }));
    apiMock.mockImplementation((_account, input) => Promise.resolve({ body:
      input.path.includes("publish_by_inventory_item_group") ? { listingId: "long-set-item" }
      : input.method === "POST" && input.path.endsWith("/offer") ? { offerId: "offer" }
      : { offers: [] },
    }));
    await publishEbayVariationGroup("user-1", group as never);
    const writes = apiMock.mock.calls.map(([, request]) => request).filter(request => request.method === "PUT" && /\/inventory_item(?:_group)?\//.test(request.path));
    expect(writes).toHaveLength(3);
    for (const request of writes) {
      const set = (request.body.product?.aspects ?? request.body.aspects).Set[0];
      expect(set.length).toBeLessThanOrEqual(65);
      expect(set.length).toBeGreaterThan(0);
      expect(albumName.startsWith(set)).toBe(true);
    }
    expect(group.albumName).toBe(albumName);
  });

  it("이미지 준비 예산을 넘기면 이베이 변경 없이 다음 실행으로 넘긴다", async () => {
    await expect(publishEbayVariationGroup("user-1", importedBtsGroup() as never, { prepareDeadline: Date.now() - 1 })).rejects.toBeInstanceOf(PublishContinuationError);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("게시 응답이 유실돼도 실제 성공한 묶음을 확인해 저장하고 삭제·재생성하지 않는다", async () => {
    let posted = false;
    apiMock.mockImplementation((_account, input) => {
      if (input.path.includes("publish_by_inventory_item_group")) {
        posted = true;
        return Promise.reject(new EbayApiError("timeout", 504, null));
      }
      if (input.path.endsWith("/offer") && input.method !== "POST") return Promise.resolve({ body: { offers: posted
        ? [{ offerId: `offer-${input.query.sku}`, listing: { listingId: "recovered-item", listingStatus: "ACTIVE" } }] : [] } });
      return Promise.resolve({ body: { offerId: "offer" } });
    });
    const result = await publishEbayVariationGroup("user-1", importedBtsGroup() as never);
    expect(result.listingId).toBe("recovered-item");
    expect(apiMock.mock.calls.some(([, input]) => input.method === "DELETE" || input.path.endsWith("/withdraw"))).toBe(false);
  });

  it("이전 실행이 게시 뒤 종료됐다면 같은 원격 묶음의 옵션을 단품으로 철회하지 않는다", async () => {
    const group = importedBtsGroup();
    apiMock.mockImplementation((_account, input) => Promise.resolve({ body:
      input.path.endsWith("/offer") && input.method !== "POST"
        ? { offers: [{ offerId: `offer-${input.query.sku}`, listing: { listingId: "existing-group", listingStatus: "ACTIVE" } }] }
        : input.path.includes("/inventory_item_group/") && !input.method ? { variantSKUs: group.products.map(p => p.sku) }
        : input.path.includes("publish_by_inventory_item_group") ? { listingId: "existing-group" } : {},
    }));
    await publishEbayVariationGroup("user-1", group as never);
    expect(apiMock.mock.calls.some(([, input]) => input.path.endsWith("/withdraw") || (input.path.endsWith("/offer") && input.method === "POST"))).toBe(false);
  });

  function importedBtsGroup() {
    return {
      key: "bts-merch-10", groupName: "BTS", albumName: "MERCH BOX #10", versionName: "", title: "BTS MERCH BOX #10",
      products: ["100284", "100285"].map((sku, i) => ({
        id: `bts-${i}`, sku, brand: "BTS", category: "MERCH BOX #10", productName: `BTS MERCH BOX #10 ${i ? "Jin" : "Jimin"}`,
        optionName: i ? "Jin" : "Jimin", variationName: i ? "Jin" : "Jimin", salePrice: 3000,
        ebayPrice: null, ebayCategoryId: null, ebayShippingProfile: null, ebayReturnProfile: null,
        ebayPaymentProfile: null, ebayMerchantLocationKey: "inactive-location", imageUrl: "https://img/card.jpg", ebayImageUrls: [],
      })),
    };
  }

  it("100284처럼 등록 설정이 없는 BTS 카드는 공통 카테고리·정책·USD 가격으로 옵션 등록한다", async () => {
    const actual = await vi.importActual<typeof import("@/lib/services/listingService")>("@/lib/services/listingService");
    productInputMock.mockImplementation(actual.productToListingInput);
    apiMock.mockImplementation((_account, input) => Promise.resolve({ body:
      input.path.includes("publish_by_inventory_item_group") ? { listingId: "bts-item" }
      : input.method === "POST" && input.path.endsWith("/offer") ? { offerId: "offer" }
      : { offers: [] },
    }));
    const result = await publishEbayVariationGroup("user-1", importedBtsGroup() as never);
    expect(result.listingId).toBe("bts-item");
    expect(apiMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      path: "/sell/inventory/v1/offer/publish_by_inventory_item_group",
      body: expect.objectContaining({ marketplaceId: "EBAY_US", inventoryItemGroupKey: expect.stringMatching(/^VAR-/) }),
    }));
    const offers = apiMock.mock.calls.filter(([, input]) => input.method === "POST" && input.path.endsWith("/offer"));
    expect(offers).toHaveLength(2);
    const groupPut = apiMock.mock.calls.find(([, request]) => request.method === "PUT" && request.path.includes("/inventory_item_group/"));
    expect(groupPut?.[1].body).toMatchObject({ title: "BTS Official MERCH BOX #10 Photocard Kpop", description: expect.stringContaining("<h2>BTS Official MERCH BOX #10 Photocard Kpop</h2>") });
    expect(new Set(offers.map(([, request]) => request.body.descriptionHtml)).size).toBe(1);
    for (const [, request] of offers) {
      expect(request.body).toMatchObject({ categoryId: "108857", shippingProfile: "ship", returnProfile: "return", paymentProfile: "payment", merchantLocationKey: "location", price: "12.00" });
    }
  });

  it("뒤쪽 카드의 설정 검증 실패도 어떤 eBay 등록 변경보다 먼저 중단한다", async () => {
    productInputMock.mockImplementationOnce(mockProductInput).mockImplementationOnce(() => { throw new Error("missing policy"); });
    await expect(publishEbayVariationGroup("user-1", importedBtsGroup() as never)).rejects.toThrow("missing policy");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("기존 단품을 종료한 뒤 옵션상품 게시가 성공해야 내부 연결을 바꾼다", async () => {
    apiMock.mockImplementation((_account, { method = "GET", path, query }) => {
      if (path === "/sell/inventory/v1/offer" && method === "GET") {
        return Promise.resolve({
          body: query?.sku === "SKU-1"
            ? { offers: [{ offerId: "offer-single", listing: { listingId: "old-item", listingStatus: "ACTIVE" } }] }
            : { offers: [] },
        });
      }
      if (path === "/sell/inventory/v1/offer" && method === "POST") {
        return Promise.resolve({ body: { offerId: "offer-new" } });
      }
      if (path === "/sell/inventory/v1/offer/publish_by_inventory_item_group") {
        return Promise.resolve({ body: { listingId: "group-item" } });
      }
      return Promise.resolve({ body: {} });
    });

    const result = await publishEbayVariationGroup("user-1", {
      key: "group-key",
      groupName: "IVE",
      albumName: "Album",
      versionName: "Ver",
      title: "IVE Album Ver",
      products: [
        { id: "p1", sku: "SKU-1", variationName: "A", ebayItemId: "old-item", listingStatus: "ACTIVE", ebayMarketplaceId: "EBAY_US", imageUrl: "https://img/a.jpg" },
        { id: "p2", sku: "SKU-2", variationName: "B", ebayItemId: null, listingStatus: null, ebayMarketplaceId: "EBAY_US", imageUrl: "https://img/b.jpg" },
      ],
    } as never);

    expect(result.listingId).toBe("group-item");
    const withdrawIndex = apiMock.mock.calls.findIndex(([, input]) => input.path === "/sell/inventory/v1/offer/offer-single/withdraw");
    const publishIndex = apiMock.mock.calls.findIndex(([, input]) => input.path === "/sell/inventory/v1/offer/publish_by_inventory_item_group");
    expect(withdrawIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(withdrawIndex);
    const firstInventoryPut = apiMock.mock.calls.find(([, input]) =>
      input.method === "PUT" && input.path.endsWith("/inventory_item/SKU-1"),
    );
    expect(firstInventoryPut?.[1].body).toMatchObject({
      descriptionHtml: "<h2>IVE Official Album Ver Photocard Kpop</h2><p>SKU-1 / 12.00</p>",
      imageUrls: ["https://img/central-watermarked.jpg"],
    });
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ebayItemId: "group-item", listingStatus: "ACTIVE" }),
    }));
  });

  it("옵션 게시가 실패하면 종료했던 기존 단품을 다시 게시하고 내부 연결은 바꾸지 않는다", async () => {
    apiMock.mockImplementation((_account, { method = "GET", path, query }) => {
      if (path === "/sell/inventory/v1/offer" && method === "GET") {
        return Promise.resolve({
          body: query?.sku === "SKU-1"
            ? { offers: [{ offerId: "offer-single", listing: { listingId: "old-item", listingStatus: "ACTIVE" } }] }
            : { offers: [] },
        });
      }
      if (path === "/sell/inventory/v1/offer" && method === "POST") {
        return Promise.resolve({ body: { offerId: "offer-new" } });
      }
      if (path === "/sell/inventory/v1/offer/publish_by_inventory_item_group") {
        return Promise.reject(new Error("publish failed"));
      }
      return Promise.resolve({ body: {} });
    });

    await expect(publishEbayVariationGroup("user-1", {
      key: "group-key",
      groupName: "IVE",
      albumName: "Album",
      versionName: "Ver",
      title: "IVE Album Ver",
      products: [
        { id: "p1", sku: "SKU-1", variationName: "A", ebayItemId: "old-item", listingStatus: "ACTIVE", ebayMarketplaceId: "EBAY_US", imageUrl: "https://img/a.jpg" },
        { id: "p2", sku: "SKU-2", variationName: "B", ebayItemId: null, listingStatus: null, ebayMarketplaceId: "EBAY_US", imageUrl: "https://img/b.jpg" },
      ],
    } as never)).rejects.toThrow("publish failed");

    expect(apiMock.mock.calls.some(([, input]) =>
      input.method === "DELETE" && input.path.includes("/inventory_item_group/"),
    )).toBe(true);
    expect(apiMock.mock.calls.some(([, input]) =>
      input.path === "/sell/inventory/v1/offer/offer-single/publish",
    )).toBe(true);
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
  });
});
