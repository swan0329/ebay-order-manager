import type { Product } from "@/generated/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  pricingSettings: { findUnique: vi.fn() },
  product: { update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/shopify-publication", () => ({ onlineStorePublication: vi.fn().mockResolvedValue("gid://shopify/Publication/1"), publishOnlineStore: vi.fn().mockResolvedValue(undefined) }));
const assertGalleryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/shopify-gallery", async (original) => ({ ...await original<typeof import("@/lib/shopify-gallery")>(), assertShopifyGallery: assertGalleryMock }));
const thumbnailMock = vi.hoisted(() => vi.fn());
const prepareImagesMock = vi.hoisted(() => vi.fn());
const holdPriceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/shopify-price-hold", async original => ({ ...await original<typeof import("@/lib/shopify-price-hold")>(), holdShopifyVariantForMissingPrice: holdPriceMock }));
vi.mock("@/lib/variation-thumbnail-prepare", () => ({ ensureVariationThumbnail: thumbnailMock }));
vi.mock("@/lib/listing-source-images", () => ({ prepareProductChannelImages: prepareImagesMock, prepareProductListingSource: vi.fn(async (product) => product) }));


vi.mock("@/lib/env", () => ({
  getShopifyConfig: () => ({
    storeDomain: "example.myshopify.com",
    accessToken: "test-token",
    apiVersion: "2025-10",
    locationId: "123",
  }),
}));

import {
  archiveShopifyProduct,
  getShopifyProductViewUrl,
  syncShopifyImages,
  syncShopifyPriceAndInventory,
  uploadProductToShopify,
  uploadVariationGroupToShopify,
  publishExistingShopifyProduct,
  buildShopifyVariationBodyHtml,
} from "@/lib/services/shopifyService";
import { publishOnlineStore } from "@/lib/shopify-publication";

describe("Shopify 판매페이지 주소", () => {
  it("묶음 상세 설명을 첫 카드의 멤버명이나 중복 앨범명으로 만들지 않는다", () => {
    const first = { ...linkedProduct(), brand:"BTS", category:"BTS 3RD MUSTER ARMY.ZIP+ DVD",
      productName:"BTS BTS 3RD MUSTER ARMY.ZIP+ DVD J-Hope", optionName:"J-Hope", descriptionHtml:null, memo:null };
    const html=buildShopifyVariationBodyHtml({key:"saved-key",groupName:"BTS",albumName:first.category,
      versionName:"3RD MUSTER ARMY.ZIP+ DVD",title:"old duplicate title",products:[{...first,variationName:"J-Hope"}]});
    expect(html).toContain("<p>BTS Official 3RD MUSTER ARMY.ZIP+ DVD Photocard Kpop</p>");
    expect(html).not.toContain("J-Hope");
    expect(html).not.toContain("<strong>Member:</strong>");
  });
  it("미게시 상품을 판매페이지로 가장하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { product: { status: "ACTIVE", publishedAt: null, onlineStoreUrl: null, handle: "card" }, shop: { primaryDomain: { url: "https://example.com" } } } }))));
    expect(await getShopifyProductViewUrl("123", false)).toBeNull();
  });
  it("게시된 비밀번호 스토어는 도메인과 상품 핸들로 연결한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { product: { status: "ACTIVE", publishedAt: "2026-09-10T00:00:00Z", onlineStoreUrl: null, handle: "card" }, shop: { primaryDomain: { url: "https://example.com" } } } }))));
    expect(await getShopifyProductViewUrl("123", false)).toBe("https://example.com/products/card");
  });
});

function linkedProduct(): Product {
  return {
    id: "product-1",
    sku: "SKU-1",
    productName: "IVE Rei Official Photocard",
    brand: "IVE",
    category: "Album",
    optionName: "Rei",
    imageUrl: "https://example.com/card.jpg",
    ebayImageUrls: ["https://example.com/card.jpg"],
    ebayPrice: 12.34,
    finalListingPriceUsd: 12.34,
    salePrice: null,
    stockQuantity: 3,
    shopifyProductId: "100",
    shopifyVariantId: "200",
    shopifyInventoryItemId: "300",
    shopifyStatus: "active",
  } as unknown as Product;
}

beforeEach(() => {
  prismaMock.pricingSettings.findUnique.mockResolvedValue({ id: "default" });
  prismaMock.product.findFirst.mockResolvedValue(null);
  thumbnailMock.mockResolvedValue({ url: "https://example.com/group-thumbnail.jpg" });
  prepareImagesMock.mockImplementation(async (_userId, product) => ({
    ...product,
    imageUrl: `https://example.com/processed-${product.sku}.jpg`,
    ebayImageUrls: [`https://example.com/processed-${product.sku}.jpg`],
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Shopify 가격·재고 빠른 반영", () => {
  it("가격 쓰기가 실패하면 보류 재고를 복구하지 않는다", async () => {
    const requests:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input)=>{requests.push(String(input));return new Response(JSON.stringify({errors:'failed'}),{status:422});}));
    await expect(syncShopifyPriceAndInventory({...linkedProduct(),shopifyStatus:'PRICE_HOLD'})).rejects.toThrow();
    expect(requests.some(url=>url.includes('/inventory_levels/set.json'))).toBe(false);
    expect(holdPriceMock).toHaveBeenCalledTimes(2);
  });
  it("보류 요청도 실패하면 판매 차단 완료로 표시하지 않는다", async () => {
    holdPriceMock.mockRejectedValueOnce(new Error("hold rejected")).mockRejectedValueOnce(new Error("hold rejected again"));
    // 옵션이 실제로 사라졌는지 확인하는 읽기 질의만 허용한다. 쓰기는 없어야 한다.
    const requests: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ errors: [{ message: "probe failed" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await expect(syncShopifyPriceAndInventory(linkedProduct())).rejects.toMatchObject({ status: 503, message: expect.stringContaining("판매 보류 미확인") });
    expect(requests.every(request => request.url.includes("/graphql.json") && !request.body.includes("mutation"))).toBe(true);
    expect(requests.some(request => request.url.includes("/inventory_levels/set.json"))).toBe(false);
  });
  it("USD 가격이 없으면 과거 원화 가격을 남긴 채 판매 재고를 늘리지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncShopifyPriceAndInventory({
      ...linkedProduct(), sku: "82804", finalListingPriceUsd: null, salePrice: null,
    })).resolves.toMatchObject({ status: "PRICE_HOLD", inventorySynced: true });
    expect(holdPriceMock).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ sku: "82804" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("가격 미확정이어도 품절 옵션의 수량 0 반영은 허용한다", async () => {
    const requests: Array<{url: string; init?: RequestInit}> = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url=String(input); requests.push({url, init});
      const body=url.includes("/variants/") ? {variant:{price:"2000.00"}}
        : url.includes("/inventory_levels.json?") ? {inventory_levels:[{available:0}]} : {};
      return new Response(JSON.stringify(body));
    }));
    await expect(syncShopifyPriceAndInventory({
      ...linkedProduct(), finalListingPriceUsd:null, salePrice:null,
      stockQuantity:0, pocamarketAvailableCount:0,
    })).resolves.toMatchObject({inventorySynced:true});
    expect(requests.some(r=>r.url.includes('/variants/')&&r.init?.method==='PUT')).toBe(false);
    expect(holdPriceMock).toHaveBeenCalled();
  });

  it("가격을 먼저 반영하고 재고 복구·실제 검증 뒤 보류 표시를 해제한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const body = url.includes("/variants/200.json") && init?.method === "GET"
        ? { variant: { price: "12.34" } }
        : url.includes("/inventory_levels.json?")
          ? { inventory_levels: [{ available: 3 }] }
          : url.includes("graphql")
            ? { data: { metafieldsSet: { metafields: [{ key: "price_review_required", value: "false" }], userErrors: [] } } }
          : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncShopifyPriceAndInventory(linkedProduct());

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(holdPriceMock).toHaveBeenCalledTimes(1);
    const releaseIndex = requests.findIndex(request => request.url.includes("/inventory_levels/set.json"));
    expect(requests.slice(0, releaseIndex).some(request => request.url.includes("/variants/200.json") && request.init?.method === "GET")).toBe(true);
    expect(requests.map((request) => request.url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/variants/200.json"),
        expect.stringContaining("/inventory_levels/set.json"),
      ]),
    );
    expect(requests.some((request) => request.url.includes("/products/"))).toBe(false);
    expect(requests.at(-1)?.init?.body).toContain("priceHold");
    expect(JSON.parse(String(requests.at(-1)?.init?.body)).variables.metafields[0])
      .toMatchObject({ ownerId: "gid://shopify/ProductVariant/200", value: "false" });
    expect(requests.some((request) => request.url.includes("/locations.json"))).toBe(false);

    const priceRequest = requests.find((request) => request.url.includes("/variants/"));
    const inventoryRequest = requests.find((request) =>
      request.url.includes("/inventory_levels/set.json"),
    );
    expect(JSON.parse(String(priceRequest?.init?.body))).toEqual({
      variant: { id: 200, price: "12.34" },
    });
    expect(JSON.parse(String(inventoryRequest?.init?.body))).toEqual({
      location_id: 123,
      inventory_item_id: 300,
      available: 3,
    });
    expect(result).toEqual(
      expect.objectContaining({
        syncMode: "price_inventory",
        inventorySynced: true,
        action: "updated",
      }),
    );
  });

  it("Shopify 연결 식별자가 없으면 외부 요청 전에 중단한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncShopifyPriceAndInventory({
        ...linkedProduct(),
        shopifyVariantId: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Shopify 실제 재조회 값이 다르면 완료로 반환하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes("/variants/200.json")
        ? { variant: { price: "99.99" } }
        : url.includes("/inventory_levels.json?")
          ? { inventory_levels: [{ available: 99 }] }
          : { ok: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }));

    await expect(syncShopifyPriceAndInventory(linkedProduct())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("완료 처리하지 않았습니다"),
    });
    expect(holdPriceMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.some(call => String(call[0]).includes("/inventory_levels/set.json"))).toBe(false);
  });

  it("신규등록 재시도에서 같은 SKU 상품을 회수해 중복 생성을 막는다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });

      if (String(init?.body).includes("query productMedia")) {
        return new Response(JSON.stringify({ data: { product: { variants: { nodes: [{ id: "200" }] }, media: { nodes: [] } } } }));
      }
      if (url.endsWith("/graphql.json") && String(init?.body).includes("findVariantBySku")) {
        return new Response(JSON.stringify({
          data: {
            productVariants: {
              nodes: [{
                id: "gid://shopify/ProductVariant/200",
                sku: "SKU-1",
                inventoryItem: { id: "gid://shopify/InventoryItem/300" },
                product: { id: "gid://shopify/Product/100", status: "ACTIVE" },
              }],
            },
          },
        }), { status: 200 });
      }

      if (url.includes("/products/100.json")) {
        return new Response(JSON.stringify({
          product: {
            id: 100,
            status: "active",
            variants: [{ id: 200, inventory_item_id: 300 }],
          },
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ data: { productUpdate: { userErrors: [] } } }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadProductToShopify({
      ...linkedProduct(),
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyInventoryItemId: null,
      shopifyStatus: null,
    }, undefined, "admin-1");

    expect(result).toMatchObject({
      action: "updated",
      productId: "100",
      variantId: "200",
      inventoryItemId: "300",
    });
    expect(
      requests.some(
        (request) =>
          request.url.endsWith("/products.json") && request.init?.method === "POST",
      ),
    ).toBe(false);
    expect(requests.some((request) => request.url.includes("/products/100.json"))).toBe(true);
  });

  it("신규 상품은 productSet 한 번으로 이미지·가격·재고·카테고리를 등록한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      if (body.query?.includes("findVariantBySku")) {
        return new Response(JSON.stringify({
          data: { productVariants: { nodes: [] } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: {
          productSet: {
            product: {
              id: "gid://shopify/Product/100",
              legacyResourceId: "100",
              status: "ACTIVE",
              variants: {
                nodes: [{
                  id: "gid://shopify/ProductVariant/200",
                  legacyResourceId: "200",
                  inventoryItem: {
                    id: "gid://shopify/InventoryItem/300",
                    legacyResourceId: "300",
                  },
                }],
              },
            },
            userErrors: [],
          },
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadProductToShopify({
      ...linkedProduct(),
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyInventoryItemId: null,
      shopifyStatus: null,
    }, undefined, "admin-1");

    expect(result).toMatchObject({
      action: "created",
      productId: "100",
      variantId: "200",
      inventoryItemId: "300",
      inventorySynced: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createRequest = requests.find((request) =>
      String(request.init?.body).includes("mutation createProduct"),
    );
    const createBody = JSON.parse(String(createRequest?.init?.body)) as {
      variables: { input: Record<string, unknown> };
    };
    expect(createBody.variables.input).toMatchObject({
      status: "ACTIVE",
      category: "gid://shopify/TaxonomyCategory/ae-2-2-3-3",
      variants: [{
        sku: "SKU-1",
        price: "12.34",
        inventoryQuantities: [{
          locationId: "gid://shopify/Location/123",
          name: "available",
          quantity: 3,
        }],
      }],
    });
    expect(requests.some((request) => request.url.includes("/products.json"))).toBe(false);
    expect(requests.some((request) => request.url.includes("inventory_levels"))).toBe(false);
  });

  it("신규등록 필수값이 없으면 Shopify 호출 전에 중단한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadProductToShopify({
        ...linkedProduct(),
        ebayPrice: null,
        finalListingPriceUsd: null,
        salePrice: null,
        shopifyProductId: null,
        shopifyVariantId: null,
        shopifyInventoryItemId: null,
      }, undefined, "admin-1"),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Shopify 옵션상품 자동 병합", () => {
  function newGroup(brand = "BTS") {
    return {
      key: `${brand}-album`, groupName: brand, albumName: "Album", versionName: "Ver", title: `${brand} Album Ver`,
      products: ["SKU-1", "SKU-2"].map((sku, index) => ({
        ...linkedProduct(), id: `product-${index + 1}`, sku, brand,
        shopifyProductId: null, shopifyVariantId: null, shopifyInventoryItemId: null,
        variationName: `Member ${index + 1}`,
      })),
    };
  }

  it.each(["BTS", "Stray Kids"])("%s 신규 묶음은 대표 썸네일 다음에 설정을 적용한 카드 이미지를 보낸다", async (brand) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { productSet: {
      product: { legacyResourceId: "100", status: "ACTIVE", variants: { nodes: [
        { sku: "SKU-1", legacyResourceId: "200", inventoryItem: { legacyResourceId: "300" } },
        { sku: "SKU-2", legacyResourceId: "201", inventoryItem: { legacyResourceId: "301" } },
      ] } }, userErrors: [],
    } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const group = newGroup(brand);
    await uploadVariationGroupToShopify(group, "admin-1");
    expect(thumbnailMock).toHaveBeenCalledWith("admin-1", group);
    expect(prepareImagesMock).toHaveBeenCalledTimes(2);
    const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(request.variables.input.files.map((file: { originalSource: string }) => file.originalSource)).toEqual([
      "https://example.com/group-thumbnail.jpg",
      "https://example.com/processed-SKU-1.jpg", "https://example.com/processed-SKU-2.jpg",
    ]);
    expect(request.variables.input.variants.map((variant: { file: { originalSource: string } }) => variant.file.originalSource)).toEqual([
      "https://example.com/processed-SKU-1.jpg", "https://example.com/processed-SKU-2.jpg",
    ]);
  });

  it("대표 썸네일 생성 실패 시 Shopify 상품을 만들지 않는다", async () => {
    thumbnailMock.mockRejectedValueOnce(new Error("render failed"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadVariationGroupToShopify(newGroup(), "admin-1")).rejects.toThrow("render failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("관리자 설정 없이 원본 이미지로 묶음을 등록할 수 없다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadVariationGroupToShopify(newGroup())).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("서로 다른 기존 상품의 옵션을 대표 상품으로 합치고 나머지 상품을 보관한다", async () => {
    prismaMock.pricingSettings.findUnique.mockResolvedValue({ id: "default" });
    prismaMock.product.update.mockResolvedValue({});
    const requests: Array<{ body: { query?: string; variables?: Record<string, unknown> } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
      requests.push({ body });
      if (body.query?.includes("archiveMergedProduct")) {
        return new Response(JSON.stringify({
          data: { productChangeStatus: { product: { id: "gid://shopify/Product/999", status: "ARCHIVED" }, userErrors: [] } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: {
          productSet: {
            product: {
              id: "gid://shopify/Product/100",
              legacyResourceId: "100",
              status: "ACTIVE",
              variants: { nodes: [
                { id: "gid://shopify/ProductVariant/200", legacyResourceId: "200", sku: "SKU-1", inventoryItem: { id: "gid://shopify/InventoryItem/300", legacyResourceId: "300" } },
                { id: "gid://shopify/ProductVariant/201", legacyResourceId: "201", sku: "SKU-2", inventoryItem: { id: "gid://shopify/InventoryItem/301", legacyResourceId: "301" } },
              ] },
            },
            userErrors: [],
          },
        },
      }), { status: 200 });
    }));

    const first = linkedProduct();
    const second = {
      ...linkedProduct(),
      id: "product-2",
      sku: "SKU-2",
      optionName: "Wonyoung",
      shopifyProductId: "999",
      shopifyVariantId: "888",
      shopifyInventoryItemId: "777",
    };
    const result = await uploadVariationGroupToShopify({
      key: "group-key",
      groupName: "IVE",
      albumName: "Album",
      versionName: "Ver",
      title: "IVE Album Ver",
      products: [
        { ...first, variationName: "Rei" },
        { ...second, variationName: "Wonyoung" },
      ],
    }, "admin-1");

    expect(result).toMatchObject({ productId: "100", action: "updated" });
    expect(thumbnailMock).toHaveBeenCalled();
    const productSet = requests.find((request) => request.body.query?.includes("upsertVariationProduct"));
    expect((productSet?.body.variables?.input as Record<string, unknown>).files).toBeUndefined();
    const variables = productSet?.body.variables as {
      identifier: { id: string };
      input: { variants: Array<{ sku: string; id?: string }> };
    };
    expect(variables.identifier.id).toBe("gid://shopify/Product/100");
    expect(variables.input.variants.find((variant) => variant.sku === "SKU-1")?.id).toContain("/200");
    expect(variables.input.variants.find((variant) => variant.sku === "SKU-2")?.id).toBeUndefined();
    expect(requests.some((request) => request.body.query?.includes("archiveMergedProduct"))).toBe(true);
    expect(prismaMock.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "product-2" },
      data: expect.objectContaining({ shopifyProductId: "100", shopifyVariantId: "201" }),
    }));
  });
});

describe("Shopify 판매중단", () => {
  it("연결 상품을 삭제하지 않고 ARCHIVED 상태로 바꾼다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        data: {
          productChangeStatus: {
            product: { id: "gid://shopify/Product/100", status: "ARCHIVED" },
            userErrors: [],
          },
        },
      }), { status: 200 });
    }));

    const result = await archiveShopifyProduct(linkedProduct());

    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      query: string;
      variables: { productId: string };
    };
    expect(body.query).toContain("productChangeStatus");
    expect(body.query).toContain("status: ARCHIVED");
    expect(body.variables).toEqual({ productId: "gid://shopify/Product/100" });
    expect(result).toMatchObject({ status: "archived", syncMode: "archive" });
  });
});

describe("Shopify 대표 이미지 교체", () => {
  it("단품 전체 갱신 경로로 기존 묶음 내용을 변경하지 못한다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { product: {
      variants: { nodes: [{ id: "200" }, { id: "201" }] }, media: { nodes: [] },
    } } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadProductToShopify(linkedProduct(), undefined, "admin-1")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("미승인 갤러리는 기존 상품의 게시 복구에서도 거부한다", async () => {
    vi.mocked(publishOnlineStore).mockClear();
    prismaMock.product.findMany.mockResolvedValueOnce([linkedProduct()]);
    assertGalleryMock.mockRejectedValueOnce(new Error("미승인 이미지"));
    await expect(publishExistingShopifyProduct("100", "admin-1")).rejects.toThrow("미승인");
    expect(publishOnlineStore).not.toHaveBeenCalled();
  });

  it("묶음 교체는 실제 전체 옵션의 ID와 SKU를 확인하고 이미지 연결만 변경한다", async () => {
    const first = linkedProduct();
    const second = { ...first, id: "product-2", sku: "SKU-2", shopifyVariantId: "201" };
    prismaMock.product.findFirst.mockResolvedValueOnce({ id: second.id });
    prismaMock.product.findMany.mockResolvedValueOnce([first, second]);
    let created = false;
    const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      let data: unknown;
      const newMedia = ["group-thumbnail", "processed-SKU-1", "processed-SKU-2"].map((name, i) => ({ id: `new-${i}`, status: "READY", image: { url: `https://example.com/${name}.jpg` } }));
      const media = [{ id: "old", status: "READY" }, ...(created ? newMedia : [])];
      if (body.query.includes("registeredGalleryVariants")) data = { product: { variants: { pageInfo: { hasNextPage: false }, nodes: [{ id: "gid://shopify/ProductVariant/200", sku: "SKU-1", title: "Card 1" }, { id: "gid://shopify/ProductVariant/201", sku: "SKU-2", title: "Card 2" }] } } };
      else if (body.query.includes("query productMedia")) data = { product: { media: { nodes: media } } };
      else if (body.query.includes("replaceProductImages")) { created = true; data = { productUpdate: { product: { media: { nodes: [...media, ...newMedia] } }, userErrors: [] } }; }
      else if (body.query.includes("linkApprovedVariantImages")) data = { productVariantsBulkUpdate: { productVariants: [{ id: "gid://shopify/ProductVariant/200", media: { nodes: [{ id: "new-1" }] } }, { id: "gid://shopify/ProductVariant/201", media: { nodes: [{ id: "new-2" }] } }], userErrors: [] } };
      else data = { productDeleteMedia: { mediaUserErrors: [] } };
      return new Response(JSON.stringify({ data }));
    }));
    await expect(syncShopifyImages(first, "admin-1", true)).resolves.toMatchObject({ syncMode: "images", inventorySynced: false });
    expect(requests.find((r) => r.query.includes("linkApprovedVariantImages"))?.variables.variants).toEqual([
      { id: "gid://shopify/ProductVariant/200", mediaId: "new-1" },
      { id: "gid://shopify/ProductVariant/201", mediaId: "new-2" },
    ]);
    expect(requests.findIndex((r) => r.query.includes("linkApprovedVariantImages"))).toBeLessThan(requests.findIndex((r) => r.query.includes("deleteOldProductImages")));
  });

  it("같은 Shopify 상품에 연결된 다른 카드가 있으면 갤러리를 덮어쓰지 않는다", async () => {
    prismaMock.product.findFirst.mockResolvedValueOnce({ id: "sibling" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncShopifyImages(linkedProduct(), "admin-1")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("로컬 연결이 빠져 있어도 Shopify 실제 복수 옵션을 확인해 이미지 변경을 막는다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { product: {
      variants: { nodes: [{ id: "200" }, { id: "201" }] },
      media: { nodes: [{ id: "old", status: "READY" }] },
    } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncShopifyImages(linkedProduct(), "admin-1")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("새 이미지가 준비된 뒤에만 기존 이미지를 삭제한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      if (body.query?.includes("query productMedia")) {
        return new Response(JSON.stringify({
          data: {
            product: {
              variants: { nodes: [{ id: "200" }] },
              media: { nodes: [{ id: "gid://shopify/MediaImage/old", status: "READY" }] },
            },
          },
        }), { status: 200 });
      }
      if (body.query?.includes("mutation replaceProductImages")) {
        return new Response(JSON.stringify({
          data: {
            productUpdate: {
              product: {
                media: {
                  nodes: [
                    { id: "gid://shopify/MediaImage/old", status: "READY" },
                    { id: "gid://shopify/MediaImage/new", status: "READY" },
                  ],
                },
              },
              userErrors: [],
            },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: { productDeleteMedia: { deletedMediaIds: ["old"], mediaUserErrors: [] } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncShopifyImages(linkedProduct(), "admin-1");

    expect(result).toMatchObject({ syncMode: "images", inventorySynced: false });
    expect(requests).toHaveLength(3);
    const deleteRequest = requests.find((request) =>
      String(request.init?.body).includes("deleteOldProductImages"),
    );
    expect(JSON.parse(String(deleteRequest?.init?.body)).variables).toEqual({
      productId: "gid://shopify/Product/100",
      mediaIds: ["gid://shopify/MediaImage/old"],
    });
  });
});




